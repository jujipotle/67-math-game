"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Mode,
  Screen,
  Op,
  Tile,
  BoardState,
  Step,
  SolvedRecord,
  SkippedRecord,
  Puzzle,
  RoomStateView,
} from "@/lib/types";
import { rat, applyOp, eq, ratToString } from "@/lib/rational";
import { solve } from "@/lib/solver";
import { generatePuzzle } from "@/lib/generator";
import { saveSession } from "@/lib/storage";
import { useDataSource } from "@/lib/dataSource";
import { buildApiUrl } from "@/lib/api";
import TopBar from "@/components/TopBar";
import GoalDisplay from "@/components/GoalDisplay";
import CardGrid from "@/components/CardGrid";
import OpRow from "@/components/OpRow";
import ReviewPanel from "@/components/ReviewPanel";
import SummaryView from "@/components/SummaryView";
import LeaderboardView from "@/components/LeaderboardView";
import MultiplayerHub from "@/components/MultiplayerHub";
import RoomLobby from "@/components/RoomLobby";
import RoomResults from "@/components/RoomResults";
import RoomWaiting from "@/components/RoomWaiting";
import { clearMpSeat, loadMpSeat, saveMpSeat } from "@/lib/mpSeat";
import {
  cardIndexFromCode,
  isSkipKey,
  isUndoKey,
  opFromCode,
  SKIP_KEY,
  UNDO_KEY,
} from "@/lib/keyboardShortcuts";

const NUMPAD_PREF_KEY = "useNumpadForCards";

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
}

function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
  const any = (AbortSignal as typeof AbortSignal & { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof any === "function") return any(signals);
  const ac = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ac.abort();
      break;
    }
    s.addEventListener("abort", () => ac.abort(), { once: true });
  }
  return ac.signal;
}

const MP_LONG_POLL_MS = 8000;
const SPRINT_DURATION_MS = 5 * 60 * 1000;

function makeBoardFromPuzzle(puzzle: Puzzle): BoardState {
  const tiles: Tile[] = [];
  for (let i = 0; i < 6; i++) {
    if (i < puzzle.n) {
      tiles.push({
        id: `tile-${i}`,
        value: rat(puzzle.cards[i]),
        expr: puzzle.cards[i].toString(),
        alive: true,
      });
    } else {
      tiles.push({
        id: `tile-${i}`,
        value: rat(0),
        expr: "",
        alive: false,
      });
    }
  }
  return { tiles };
}

function deepCopyBoard(board: BoardState): BoardState {
  return {
    tiles: board.tiles.map((t) => ({
      ...t,
      value: { n: t.value.n, d: t.value.d },
    })),
  };
}

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const OP_DISPLAY: Record<Op, string> = {
  "+": "+",
  "-": "−",
  "*": "×",
  "/": "÷",
};

function SprintInfoHint() {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute -right-1 -top-1">
      <button
        type="button"
        aria-label="How sprint targets rotate"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="h-5 w-5 rounded-full border border-neutral-300 bg-white text-[10px] text-neutral-500 flex items-center justify-center shadow-sm"
      >
        ?
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-lg bg-white shadow-lg border border-neutral-200 p-3 text-xs text-neutral-600 z-10">
          <div className="font-semibold mb-1">Balanced sprint scoring</div>
          <p>
            In 5-minute sprint, targets rotate between 1–66, 67–133, and 134–200 with 4, 5, then 6 cards.
            Skipping a puzzle keeps you in the same range, so you can&apos;t hunt for easier targets.
          </p>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { target, setTarget, isDev } = useDataSource();
  const [screen, setScreen] = useState<Screen>("home");
  const [mode, setMode] = useState<Mode>("practice");
  const [solvedCount, setSolvedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [solved, setSolved] = useState<SolvedRecord[]>([]);
  const [skipped, setSkipped] = useState<SkippedRecord[]>([]);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [board, setBoard] = useState<BoardState | null>(null);
  const [historyStack, setHistoryStack] = useState<BoardState[]>([]);
  const [stepStack, setStepStack] = useState<Step[]>([]);
  const [selectedTile, setSelectedTile] = useState<number | null>(null);
  const [selectedOp, setSelectedOp] = useState<Op | null>(null);
  const [useFaceCards, setUseFaceCards] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [numpadCardLayout, setNumpadCardLayout] = useState(false);
  const [sprintSessionId, setSprintSessionId] = useState<string | null>(null);
  const [sprintPuzzleIdx, setSprintPuzzleIdx] = useState<number | null>(null);
  const [playElapsedMs, setPlayElapsedMs] = useState(0);
  const [sprintRemainingMs, setSprintRemainingMs] = useState(SPRINT_DURATION_MS);
  const [timerRunning, setTimerRunning] = useState(false);
  const [currentSolutions, setCurrentSolutions] = useState<string[]>([]);
  const [solutionsReady, setSolutionsReady] = useState(false);
  const [generating, setGenerating] = useState(false);
  const lastTickRef = useRef<number>(0);
  const solveAbortRef = useRef(0);
  const puzzleQueueRef = useRef<Puzzle[]>([]);
  const queueGenerationInFlightRef = useRef(false);
  const workerRef = useRef<Worker | null>(null);
  const workerBusyRef = useRef(false);
  const bgWorkerRef = useRef<Worker | null>(null);
  const bgWorkerBusyRef = useRef(false);
  const bgTaskRef = useRef<{ kind: "solved" | "skipped"; sessionIndex: number } | null>(null);
  const skipDebounceRef = useRef(0);
  const sessionIndexRef = useRef(1);
  const leaderboardCacheRef = useRef<{ id: number; name: string; score: number; createdAt: number }[] | null>(null);
  const [mpRoom, setMpRoom] = useState<RoomStateView | null>(null);
  const [mpPlayerId, setMpPlayerId] = useState<string | null>(null);
  const [mpPrefillRoom, setMpPrefillRoom] = useState<string | null>(null);
  const [waitingPractice, setWaitingPractice] = useState(false);
  const [mpStarting, setMpStarting] = useState(false);
  const [mpHostLeaveOpen, setMpHostLeaveOpen] = useState(false);
  const [mpEndConfirmOpen, setMpEndConfirmOpen] = useState(false);
  const [mpEnding, setMpEnding] = useState(false);
  const [mpWaitIdle, setMpWaitIdle] = useState(false);
  const [mpActionError, setMpActionError] = useState<string | null>(null);
  const [mpPopup, setMpPopup] = useState<{ title: string; body?: string } | null>(null);
  const [homePopup, setHomePopup] = useState<{ title: string; body?: string } | null>(null);
  const mpPuzzlesRef = useRef<Map<number, Puzzle>>(new Map());
  const mpPlayerIdRef = useRef<string | null>(null);
  const mpRoomIdRef = useRef<string | null>(null);
  const mpIdxRef = useRef(1);
  const waitingPracticeRef = useRef(false);
  const mpPendingSolveRef = useRef(false);
  const mpWasHostRef = useRef<boolean | null>(null);
  const mpPollFailsRef = useRef(0);
  const didRestoreSeatRef = useRef(false);
  const mpSyncRef = useRef("");

  const QUEUE_TARGET = 4;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(NUMPAD_PREF_KEY);
      if (saved === "1") setNumpadCardLayout(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(NUMPAD_PREF_KEY, numpadCardLayout ? "1" : "0");
    } catch {
      // ignore
    }
  }, [numpadCardLayout]);

  useEffect(() => {
    if (screen !== "home") return;
    let cancelled = false;
    fetch(buildApiUrl("/api/leaderboard", target), { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { entries?: { id: number; name: string; score: number; createdAt: number }[] }) => {
        if (!cancelled && data?.entries) leaderboardCacheRef.current = data.entries;
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [screen, target]);

  useEffect(() => {
    if (!timerRunning) return;
    lastTickRef.current = performance.now();

    const interval = setInterval(() => {
      const now = performance.now();
      let dt = now - lastTickRef.current;
      lastTickRef.current = now;
      // Cap dt to prevent tab throttling from eating time in one tick
      if (dt > 2000) dt = 2000;

      if (mode === "practice" && !waitingPractice) {
        setPlayElapsedMs((prev) => prev + dt);
      } else if (mode === "multiplayer" || waitingPractice) {
        const ends = mpRoom?.roundEndsAt;
        if (ends != null) {
          setSprintRemainingMs(Math.max(0, ends - Date.now()));
        }
      } else {
        setSprintRemainingMs((prev) => {
          const next = prev - dt;
          if (next <= 0) {
            setTimerRunning(false);
            return 0;
          }
          return next;
        });
      }
    }, 100);

    return () => clearInterval(interval);
  }, [timerRunning, mode, waitingPractice, mpRoom?.roundEndsAt]);

  const refillPuzzleQueueRef = useRef<() => void>(() => {});

  const refillPuzzleQueue = useCallback(() => {
    if (puzzleQueueRef.current.length >= QUEUE_TARGET) return;
    if (queueGenerationInFlightRef.current) return;

    const addAndRefill = (p: Puzzle) => {
      if (puzzleQueueRef.current.length >= QUEUE_TARGET) return;
      puzzleQueueRef.current.push(p);
      queueGenerationInFlightRef.current = false;
      refillPuzzleQueueRef.current();
    };

    queueGenerationInFlightRef.current = true;
    // Never use the main worker for preGenerate – keep it 100% for current puzzle solveAll.
    // Use background worker when idle, else main thread.
    if (bgWorkerRef.current && !bgWorkerBusyRef.current) {
      bgWorkerRef.current.postMessage({ type: "preGenerate" });
      return;
    }
    setTimeout(() => {
      const p = generatePuzzle();
      addAndRefill(p);
    }, 0);
  }, []);

  refillPuzzleQueueRef.current = refillPuzzleQueue;

  useEffect(() => {
    try {
      workerRef.current = new Worker(new URL("../workers/puzzle.worker.ts", import.meta.url));
      workerRef.current.onmessage = (
        e: MessageEvent<
          | { kind: "puzzle"; puzzle: Puzzle }
          | { kind: "solutions"; id: number; solutions: string[] }
        >
      ) => {
        const msg = e.data;
        if (msg.kind === "puzzle") {
          if (puzzleQueueRef.current.length < QUEUE_TARGET) {
            puzzleQueueRef.current.push(msg.puzzle);
          }
          queueGenerationInFlightRef.current = false;
          refillPuzzleQueueRef.current();
        } else if (msg.kind === "solutions") {
          workerBusyRef.current = false;
          if (msg.id !== solveAbortRef.current) return;
          setCurrentSolutions(msg.solutions);
          setSolutionsReady(true);
        }
      };
      workerRef.current.onerror = () => {
        workerBusyRef.current = false;
        queueGenerationInFlightRef.current = false;
        workerRef.current = null;
      };

      // Background worker for historical solutions (session review / backfill).
      bgWorkerRef.current = new Worker(new URL("../workers/puzzle.worker.ts", import.meta.url));
      bgWorkerRef.current.onmessage = (
        e: MessageEvent<
          | { kind: "puzzle"; puzzle: Puzzle }
          | { kind: "solutions"; id: number; solutions: string[] }
        >
      ) => {
        const msg = e.data;
        if (msg.kind === "puzzle") {
          if (puzzleQueueRef.current.length < QUEUE_TARGET) {
            puzzleQueueRef.current.push(msg.puzzle);
          }
          queueGenerationInFlightRef.current = false;
          refillPuzzleQueueRef.current();
        } else if (msg.kind === "solutions") {
          bgWorkerBusyRef.current = false;
          const task = bgTaskRef.current;
          bgTaskRef.current = null;
          if (!task) return;
          if (task.kind === "solved") {
            setSolved((prev) =>
              prev.map((r) =>
                r.sessionIndex === task.sessionIndex
                  ? { ...r, solutions: msg.solutions, solutionsPending: false }
                  : r
              )
            );
          } else {
            setSkipped((prev) =>
              prev.map((r) =>
                r.sessionIndex === task.sessionIndex
                  ? { ...r, solutions: msg.solutions, solutionsPending: false }
                  : r
              )
            );
          }
        }
      };
      bgWorkerRef.current.onerror = () => {
        bgWorkerBusyRef.current = false;
        bgTaskRef.current = null;
        bgWorkerRef.current = null;
      };
    } catch {
      workerRef.current = null;
      bgWorkerRef.current = null;
    }
    return () => {
      workerRef.current?.terminate();
      bgWorkerRef.current?.terminate();
    };
  }, []);

  const startNewPuzzle = useCallback(() => {
    const cached = puzzleQueueRef.current.shift();
    if (cached) {
      const puzzleForPlay = cached;
      const b = makeBoardFromPuzzle(puzzleForPlay);
      setPuzzle(puzzleForPlay);
      setBoard(b);
      setCurrentSolutions([]);
      setSolutionsReady(false);
      setHistoryStack([]);
      setStepStack([]);
      setSelectedTile(null);
      setSelectedOp(null);
      setGenerating(false);
      setTimerRunning(true);
      skipDebounceRef.current = 0;
      refillPuzzleQueue();

      // Kick off full solution enumeration in the background.
      const id = ++solveAbortRef.current;
      if (workerRef.current) {
        workerBusyRef.current = true;
        workerRef.current.postMessage({
          type: "solveAll",
          id,
          cards: puzzleForPlay.cards,
          goal: puzzleForPlay.goal,
        });
      } else {
        setTimeout(() => {
          if (solveAbortRef.current !== id) return;
          const solutions = solve(puzzleForPlay.cards, puzzleForPlay.goal);
          if (solveAbortRef.current !== id) return;
          setCurrentSolutions(solutions);
          setSolutionsReady(true);
        }, 0);
      }
      return;
    }

    setGenerating(true);
    const puzzleId = ++solveAbortRef.current;
    setTimeout(() => {
      const p = generatePuzzle();
      if (solveAbortRef.current !== puzzleId) return;
      const b = makeBoardFromPuzzle(p);
      setPuzzle(p);
      setBoard(b);
      setCurrentSolutions([]);
      setSolutionsReady(false);
      setHistoryStack([]);
      setStepStack([]);
      setSelectedTile(null);
      setSelectedOp(null);
      setGenerating(false);
      setTimerRunning(true);
      skipDebounceRef.current = 0;

      // Enumerate all solutions in the background.
      const id = puzzleId;
      if (workerRef.current) {
        workerBusyRef.current = true;
        workerRef.current.postMessage({
          type: "solveAll",
          id,
          cards: p.cards,
          goal: p.goal,
        });
      } else {
        setTimeout(() => {
          if (solveAbortRef.current !== id) return;
          const solutions = solve(p.cards, p.goal);
          if (solveAbortRef.current !== id) return;
          setCurrentSolutions(solutions);
          setSolutionsReady(true);
        }, 0);
      }
      refillPuzzleQueue();
    }, 0);
  }, [refillPuzzleQueue]);

  useEffect(() => {
    refillPuzzleQueue();
  }, [screen, refillPuzzleQueue]);

  const startSession = useCallback(
    (m: Mode) => {
      setHomePopup(null);
      setMode(m);
      setPuzzle(null);
      setBoard(null);
      setScreen("play");
      setSolvedCount(0);
      setSkippedCount(0);
      setSolved([]);
      setSkipped([]);
      sessionIndexRef.current = 1;
      setPlayElapsedMs(0);
      setSprintRemainingMs(SPRINT_DURATION_MS);
      setSprintSessionId(null);
      setSprintPuzzleIdx(null);

      if (m === "sprint") {
        setGenerating(true);
        setTimerRunning(false);
        (async () => {
          try {
            // The server is the puzzle authority: it creates the session and
            // issues puzzle #1. The client never sends goal/cards.
            const res = await fetch(buildApiUrl("/api/sprint/start", target), { method: "POST" });
            const data = (await res.json()) as {
              sessionId?: string;
              endsAt?: number;
              idx?: number;
              goal?: number;
              cards?: number[];
              error?: string;
            };
            if (
              !res.ok ||
              !data.sessionId ||
              data.endsAt == null ||
              data.goal == null ||
              !Array.isArray(data.cards)
            ) {
              throw new Error(data.error || "Failed to start sprint");
            }

            const puzzleForPlay: Puzzle = {
              goal: data.goal,
              cards: data.cards,
              n: data.cards.length,
            };

            setSprintSessionId(data.sessionId);
            setSprintPuzzleIdx(data.idx ?? 1);
            setSprintRemainingMs(Math.max(0, data.endsAt - Date.now()));
            const b = makeBoardFromPuzzle(puzzleForPlay);
            setPuzzle(puzzleForPlay);
            setBoard(b);
            setCurrentSolutions([]);
            setSolutionsReady(false);
            setHistoryStack([]);
            setStepStack([]);
            setSelectedTile(null);
            setSelectedOp(null);
            setGenerating(false);
            setTimerRunning(true);
            skipDebounceRef.current = 0;

            const id = ++solveAbortRef.current;
            if (workerRef.current) {
              workerBusyRef.current = true;
              workerRef.current.postMessage({
                type: "solveAll",
                id,
                cards: puzzleForPlay.cards,
                goal: puzzleForPlay.goal,
              });
            } else {
              setTimeout(() => {
                if (solveAbortRef.current !== id) return;
                const solutions = solve(puzzleForPlay.cards, puzzleForPlay.goal);
                if (solveAbortRef.current !== id) return;
                setCurrentSolutions(solutions);
                setSolutionsReady(true);
              }, 0);
            }
          } catch {
            setGenerating(false);
            setScreen("home");
          }
        })();
        return;
      }

      startNewPuzzle();
    },
    [startNewPuzzle, target]
  );

  const cacheMpPuzzles = useCallback((room: RoomStateView) => {
    for (const p of room.puzzles) {
      mpPuzzlesRef.current.set(p.idx, {
        goal: p.goal,
        cards: p.cards,
        n: p.cards.length,
      });
    }
  }, []);

  const loadMpPuzzle = useCallback(
    (idx: number) => {
      mpIdxRef.current = idx;
      const p = mpPuzzlesRef.current.get(idx);
      if (!p) {
        setPuzzle(null);
        setBoard(null);
        setGenerating(true);
        return;
      }
      const b = makeBoardFromPuzzle(p);
      setPuzzle(p);
      setBoard(b);
      setCurrentSolutions([]);
      setSolutionsReady(false);
      setHistoryStack([]);
      setStepStack([]);
      setSelectedTile(null);
      setSelectedOp(null);
      setGenerating(false);
      setTimerRunning(true);
      skipDebounceRef.current = 0;

      const id = ++solveAbortRef.current;
      if (workerRef.current) {
        workerBusyRef.current = true;
        workerRef.current.postMessage({
          type: "solveAll",
          id,
          cards: p.cards,
          goal: p.goal,
        });
      } else {
        setTimeout(() => {
          if (solveAbortRef.current !== id) return;
          const solutions = solve(p.cards, p.goal);
          if (solveAbortRef.current !== id) return;
          setCurrentSolutions(solutions);
          setSolutionsReady(true);
        }, 0);
      }
    },
    []
  );

  const mpClear = useCallback(() => {
    clearMpSeat();
    setMpRoom(null);
    setMpPlayerId(null);
    mpPlayerIdRef.current = null;
    mpRoomIdRef.current = null;
    mpPuzzlesRef.current.clear();
    mpIdxRef.current = 1;
    setWaitingPractice(false);
    waitingPracticeRef.current = false;
    setMpStarting(false);
    setMpHostLeaveOpen(false);
    setMpEndConfirmOpen(false);
    setMpEnding(false);
    setMpWaitIdle(false);
    setMpPopup(null);
    setMpActionError(null);
    mpPendingSolveRef.current = false;
    mpWasHostRef.current = null;
    mpPollFailsRef.current = 0;
    mpSyncRef.current = "";
    setTimerRunning(false);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  const mpLeave = useCallback(
    async (newHostId?: string) => {
      const roomId = mpRoomIdRef.current;
      const playerId = mpPlayerIdRef.current;
      if (roomId && playerId) {
        try {
          await fetch(buildApiUrl(`/api/rooms/${roomId}`, target), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "leave", playerId, newHostId }),
            keepalive: true,
          });
        } catch {
          // ignore
        }
      }
      mpClear();
      setScreen("home");
    },
    [mpClear, target]
  );

  const applyRoomSnapshot = useCallback(
    (room: RoomStateView) => {
      setMpRoom(room);
      mpRoomIdRef.current = room.id;
      if (room.sync) mpSyncRef.current = room.sync;
      saveMpSeat({
        roomId: room.id,
        playerId: room.you.playerId,
        roomName: room.name,
      });
      if (typeof window !== "undefined") {
        window.history.replaceState(
          null,
          "",
          `/?room=${encodeURIComponent(room.name)}`
        );
      }
      cacheMpPuzzles(room);
      if (room.roundEndsAt != null) {
        setSprintRemainingMs(Math.max(0, room.roundEndsAt - Date.now()));
      }

      if (mpWasHostRef.current === false && room.you.isHost) {
        setMpPopup({ title: "You're the host now." });
      }
      mpWasHostRef.current = room.you.isHost;

      if (room.status === "lobby") {
        setWaitingPractice(false);
        waitingPracticeRef.current = false;
        setTimerRunning(false);
        setScreen("mp-lobby");
        return;
      }

      if (room.status === "results") {
        setWaitingPractice(false);
        waitingPracticeRef.current = false;
        setMpEndConfirmOpen(false);
        setTimerRunning(false);
        setScreen("mp-results");
        return;
      }

      if (room.you.role === "waiting") {
        setScreen((prev) =>
          prev === "play" && waitingPracticeRef.current
            ? prev
            : prev === "review" && waitingPracticeRef.current
              ? prev
              : "mp-wait"
        );
        return;
      }

      setWaitingPractice(false);
      waitingPracticeRef.current = false;
      setMode("multiplayer");
      setTimerRunning(true);
      if (!mpPendingSolveRef.current) {
        setSolvedCount(room.you.score);
      }
      setScreen((prev) => {
        if (mpPendingSolveRef.current && prev === "play") {
          return "play";
        }
        if (prev !== "play") {
          loadMpPuzzle(room.you.puzzleIdx);
        } else if (room.you.puzzleIdx > mpIdxRef.current) {
          loadMpPuzzle(room.you.puzzleIdx);
        } else if (!mpPuzzlesRef.current.get(mpIdxRef.current) && room.puzzles.length) {
          loadMpPuzzle(mpIdxRef.current);
        }
        return "play";
      });
    },
    [cacheMpPuzzles, loadMpPuzzle]
  );

  const applyRoomSnapshotRef = useRef(applyRoomSnapshot);
  applyRoomSnapshotRef.current = applyRoomSnapshot;

  const mpEntered = useCallback(
    (room: RoomStateView) => {
      setMpPlayerId(room.you.playerId);
      mpPlayerIdRef.current = room.you.playerId;
      mpRoomIdRef.current = room.id;
      if (typeof window !== "undefined") {
        window.history.replaceState(
          null,
          "",
          `/?room=${encodeURIComponent(room.name)}`
        );
      }
      applyRoomSnapshot(room);
    },
    [applyRoomSnapshot]
  );

  const mpStart = useCallback(async () => {
    const roomId = mpRoomIdRef.current;
    const playerId = mpPlayerIdRef.current;
    if (!roomId || !playerId) return;
    setMpStarting(true);
    try {
      const res = await fetch(buildApiUrl(`/api/rooms/${roomId}`, target), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", playerId }),
      });
      const data = (await res.json()) as { room?: RoomStateView; error?: string };
      if (res.ok && data.room) {
        setMpActionError(null);
        applyRoomSnapshot(data.room);
      } else {
        setMpActionError(data.error || "Could not start the round");
      }
    } finally {
      setMpStarting(false);
    }
  }, [applyRoomSnapshot, target]);

  const mpSetDuration = useCallback(
    async (durationMs: number) => {
      const roomId = mpRoomIdRef.current;
      const playerId = mpPlayerIdRef.current;
      if (!roomId || !playerId) return;
      try {
        const res = await fetch(buildApiUrl(`/api/rooms/${roomId}`, target), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "duration", playerId, durationMs }),
        });
        const data = (await res.json()) as { room?: RoomStateView; error?: string };
        if (res.ok && data.room) {
          setMpActionError(null);
          applyRoomSnapshot(data.room);
        } else {
          setMpActionError(data.error || "Could not update round length");
        }
      } catch {
        setMpActionError("Could not update round length");
      }
    },
    [applyRoomSnapshot, target]
  );

  const mpEndRound = useCallback(async () => {
    const roomId = mpRoomIdRef.current;
    const playerId = mpPlayerIdRef.current;
    if (!roomId || !playerId) return;
    setMpEnding(true);
    try {
      const res = await fetch(buildApiUrl(`/api/rooms/${roomId}`, target), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end", playerId }),
      });
      const data = (await res.json()) as { room?: RoomStateView; error?: string };
      if (res.ok && data.room) {
        setMpEndConfirmOpen(false);
        setMpActionError(null);
        applyRoomSnapshot(data.room);
      } else {
        setMpActionError(data.error || "Could not end the round");
      }
    } finally {
      setMpEnding(false);
    }
  }, [applyRoomSnapshot, target]);

  const mpKick = useCallback(
    async (targetId: string) => {
      const roomId = mpRoomIdRef.current;
      const playerId = mpPlayerIdRef.current;
      if (!roomId || !playerId || !targetId) return;
      const res = await fetch(buildApiUrl(`/api/rooms/${roomId}`, target), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kick", playerId, targetId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMpActionError(data.error || "Could not remove that player");
        return;
      }
      setMpActionError(null);
      const snap = await fetch(
        buildApiUrl(`/api/rooms/${roomId}?playerId=${playerId}`, target),
        { cache: "no-store" }
      );
      const snapData = (await snap.json()) as { room?: RoomStateView };
      if (snap.ok && snapData.room) applyRoomSnapshot(snapData.room);
      void data;
    },
    [applyRoomSnapshot, target]
  );

  const mpSubmitSolve = useCallback(
    async (finalExpr: string) => {
      const roomId = mpRoomIdRef.current;
      const playerId = mpPlayerIdRef.current;
      const idx = mpIdxRef.current;
      if (!roomId || !playerId) return;

      mpPendingSolveRef.current = true;
      const nextIdx = idx + 1;
      setSolvedCount((c) => c + 1);
      if (mpPuzzlesRef.current.has(nextIdx)) {
        loadMpPuzzle(nextIdx);
      } else {
        mpIdxRef.current = nextIdx;
        setPuzzle(null);
        setBoard(null);
        setGenerating(true);
      }

      const rewind = () => {
        mpPendingSolveRef.current = false;
        setSolvedCount((c) => Math.max(0, c - 1));
        loadMpPuzzle(idx);
      };

      try {
        const res = await fetch(buildApiUrl(`/api/rooms/${roomId}`, target), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "solve", playerId, idx, finalExpr }),
        });
        const data = (await res.json()) as { room?: RoomStateView };
        if (res.ok && data.room) {
          mpPendingSolveRef.current = false;
          cacheMpPuzzles(data.room);
          setMpRoom(data.room);
          setSolvedCount(data.room.you.score);
          if (!mpPuzzlesRef.current.get(mpIdxRef.current)) {
            loadMpPuzzle(data.room.you.puzzleIdx);
          }
        } else {
          rewind();
        }
      } catch {
        rewind();
      }
    },
    [cacheMpPuzzles, loadMpPuzzle, target]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (didRestoreSeatRef.current) return;
    didRestoreSeatRef.current = true;
    const q = new URLSearchParams(window.location.search).get("room");
    const seat = loadMpSeat();
    if (!seat) {
      if (q) {
        setMpPrefillRoom(q);
        setScreen("mp-hub");
      }
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          buildApiUrl(`/api/rooms/${seat.roomId}?playerId=${seat.playerId}`, target),
          { cache: "no-store" }
        );
        const data = (await res.json()) as { room?: RoomStateView };
        if (cancelled) return;
        if (res.ok && data.room) {
          setMpPlayerId(data.room.you.playerId);
          mpPlayerIdRef.current = data.room.you.playerId;
          mpRoomIdRef.current = data.room.id;
          applyRoomSnapshotRef.current(data.room);
          return;
        }
        if (cancelled) return;
        if (res.status === 404 || res.status === 403) {
          clearMpSeat();
        }
      } catch {
        // keep seat; user can retry from the hub
      }
      if (cancelled) return;
      setMpPrefillRoom(q || seat.roomName);
      setScreen("mp-hub");
    })();

    return () => {
      cancelled = true;
    };
  }, [target]);

  useEffect(() => {
    waitingPracticeRef.current = waitingPractice;
  }, [waitingPractice]);

  useEffect(() => {
    const roomId = mpRoomIdRef.current;
    const playerId = mpPlayerIdRef.current;
    if (!roomId || !playerId) return;
    const inRoom =
      screen === "mp-lobby" ||
      screen === "mp-wait" ||
      screen === "mp-results" ||
      screen === "review" ||
      (screen === "play" && (mode === "multiplayer" || waitingPractice));
    if (!inRoom) return;

    let cancelled = false;
    const loopAc = new AbortController();
    let refreshAc = new AbortController();
    const leaveRoomQuietly = (popup: { title: string; body?: string }) => {
      mpClear();
      setHomePopup(popup);
      setScreen("home");
    };
    const loop = async () => {
      let immediate = true;
      while (!cancelled && !loopAc.signal.aborted) {
        const since = mpSyncRef.current;
        const params = new URLSearchParams({ playerId });
        if (!immediate && since) {
          params.set("since", since);
          params.set("waitMs", String(MP_LONG_POLL_MS));
        }
        immediate = false;
        const signal = mergeAbortSignals([loopAc.signal, refreshAc.signal]);
        try {
          const res = await fetch(
            buildApiUrl(`/api/rooms/${roomId}?${params.toString()}`, target),
            { cache: "no-store", signal }
          );
          const data = (await res.json()) as {
            room?: RoomStateView;
            error?: string;
            roomName?: string;
            kickedBy?: string;
          };
          if (cancelled) return;
          if (res.ok && data.room) {
            mpPollFailsRef.current = 0;
            if (data.room.sync) mpSyncRef.current = data.room.sync;
            applyRoomSnapshot(data.room);
            if (!data.room.sync) {
              await abortableSleep(1000, loopAc.signal);
            }
            continue;
          }
          if (data.error === "kicked") {
            const roomName = data.roomName || mpRoom?.name || "the room";
            const kickedBy = data.kickedBy;
            leaveRoomQuietly({
              title: `You were removed from ${roomName}.`,
              body: kickedBy ? `Removed by ${kickedBy}.` : undefined,
            });
            return;
          }
          if (res.status === 404 || res.status === 403) {
            mpPollFailsRef.current += 1;
            if (mpPollFailsRef.current >= 2) {
              const roomName = mpRoom?.name;
              leaveRoomQuietly({
                title: roomName ? `${roomName} closed.` : "That room closed.",
              });
              return;
            }
            await abortableSleep(300, loopAc.signal);
            continue;
          }
          await abortableSleep(250, loopAc.signal);
        } catch {
          if (cancelled || loopAc.signal.aborted) return;
          if (refreshAc.signal.aborted) {
            refreshAc = new AbortController();
            immediate = true;
            continue;
          }
          await abortableSleep(250, loopAc.signal);
        }
      }
    };
    void loop();
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      refreshAc.abort();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      loopAc.abort();
      refreshAc.abort();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [applyRoomSnapshot, mpClear, mpRoom?.id, mpRoom?.name, mpPlayerId, screen, mode, waitingPractice, target]);

  useEffect(() => {
    const onHide = () => {
      const roomId = mpRoomIdRef.current;
      const playerId = mpPlayerIdRef.current;
      if (!roomId || !playerId) return;
      const url = buildApiUrl(`/api/rooms/${roomId}`, target);
      const blob = new Blob(
        [JSON.stringify({ action: "heartbeat", playerId })],
        { type: "application/json" }
      );
      navigator.sendBeacon(url, blob);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [target]);

  const hostNeedsSuccessor =
    !!mpRoom?.you.isHost &&
    mpRoom.players.some((p) => p.id && p.id !== mpRoom.you.playerId);

  const finishSoloSession = useCallback(() => {
    setTimerRunning(false);
    setScreen("summary");

    const totalTime =
      mode === "practice" ? playElapsedMs : SPRINT_DURATION_MS - sprintRemainingMs;
    saveSession({
      mode,
      solved,
      totalTimeMs: totalTime,
      date: new Date().toISOString(),
    });
  }, [mode, playElapsedMs, sprintRemainingMs, solved]);

  const handleQuit = useCallback(() => {
    if (mpHostLeaveOpen) return;
    if (mpPlayerIdRef.current) {
      if (hostNeedsSuccessor) {
        setMpHostLeaveOpen(true);
        return;
      }
      void mpLeave();
      return;
    }
    finishSoloSession();
  }, [mpHostLeaveOpen, mpLeave, hostNeedsSuccessor, finishSoloSession]);

  const handleTimeUp = useCallback(() => {
    setTimerRunning(false);
    if (mode === "sprint" && sprintSessionId && sprintPuzzleIdx) {
      fetch(buildApiUrl("/api/sprint/mark", target), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sprintSessionId,
          idx: sprintPuzzleIdx,
          outcome: "skipped",
        }),
      }).catch(() => {});
    }
    setSkippedCount((c) => c + 1);
    setStepStack([]);
    if (puzzle) {
      const idx = sessionIndexRef.current++;
      setSkipped((prev) => [
        ...prev,
        {
          puzzle,
          solutions: solutionsReady ? currentSolutions : [],
          sessionIndex: idx,
          solutionsPending: !solutionsReady,
        },
      ]);
    }
    setScreen("review");
  }, [mode, puzzle, solutionsReady, currentSolutions, sprintSessionId, sprintPuzzleIdx, target]);

  useEffect(() => {
    if (mode === "sprint" && sprintRemainingMs <= 0 && screen === "play") {
      handleTimeUp();
    }
  }, [sprintRemainingMs, screen, mode, handleTimeUp]);

  // Background solution generation queue for past puzzles.
  // Priority: solved records in session order, then skipped records.
  useEffect(() => {
    if (!bgWorkerRef.current) return;
    if (bgWorkerBusyRef.current) return;
    if (screen === "home" || screen === "leaderboard") return;
    // Never run background solution jobs while the current puzzle's solutions
    // are still generating – prioritize current player interaction.
    if (puzzle && !solutionsReady) return;

    // Solved first.
    const nextSolved = solved.find(
      (r) => r.puzzle && (!r.solutions || r.solutions.length === 0)
    );
    if (nextSolved && nextSolved.puzzle) {
      bgWorkerBusyRef.current = true;
      bgTaskRef.current = { kind: "solved", sessionIndex: nextSolved.sessionIndex };
      bgWorkerRef.current.postMessage({
        type: "solveAll",
        id: nextSolved.sessionIndex,
        cards: nextSolved.puzzle.cards,
        goal: nextSolved.puzzle.goal,
      });
      return;
    }

    // Then skipped.
    const nextSkipped = skipped.find(
      (r) => r.puzzle && (!r.solutions || r.solutions.length === 0)
    );
    if (nextSkipped && nextSkipped.puzzle) {
      bgWorkerBusyRef.current = true;
      bgTaskRef.current = { kind: "skipped", sessionIndex: nextSkipped.sessionIndex };
      bgWorkerRef.current.postMessage({
        type: "solveAll",
        id: nextSkipped.sessionIndex,
        cards: nextSkipped.puzzle.cards,
        goal: nextSkipped.puzzle.goal,
      });
    }
  }, [screen, solved, skipped, puzzle, solutionsReady]);

  const handleTileClick = (i: number) => {
    if (!board || !board.tiles[i].alive) return;

    // Allow clicking an already-selected tile to deselect it
    if (selectedTile === i) {
      setSelectedTile(null);
      setSelectedOp(null);
      return;
    }

    if (selectedTile === null) {
      setSelectedTile(i);
      return;
    }

    if (selectedOp === null) {
      setSelectedTile(i);
      return;
    }

    const prevBoard = deepCopyBoard(board);
    const a = board.tiles[selectedTile];
    const b = board.tiles[i];

    const result = applyOp(a.value, selectedOp, b.value);
    if (result === null) {
      setSelectedTile(null);
      setSelectedOp(null);
      return;
    }

    const resultExpr = `(${a.expr} ${OP_DISPLAY[selectedOp]} ${b.expr})`;

    const step: Step = {
      aExpr: a.expr,
      bExpr: b.expr,
      op: selectedOp,
      resultExpr,
      resultValue: result,
    };

    const newBoard = deepCopyBoard(board);
    newBoard.tiles[selectedTile] = { ...newBoard.tiles[selectedTile], alive: false };
    newBoard.tiles[i] = {
      ...newBoard.tiles[i],
      value: result,
      expr: resultExpr,
    };

    setHistoryStack((prev) => [...prev, prevBoard]);
    setStepStack((prev) => [...prev, step]);
    setBoard(newBoard);
    setSelectedTile(i);
    setSelectedOp(null);

    const alive = newBoard.tiles.filter((t) => t.alive);
    if (alive.length === 1) {
      const goalRat = rat(puzzle!.goal);
      if (eq(alive[0].value, goalRat)) {
        if (mode === "multiplayer") {
          void mpSubmitSolve(resultExpr);
          return;
        }
        setTimerRunning(false);
        const elapsed =
          mode === "practice"
            ? playElapsedMs
            : SPRINT_DURATION_MS - sprintRemainingMs;
        const stepsWithLast = [...stepStack, step];
        const idx = sessionIndexRef.current++;
        const record: SolvedRecord = {
          puzzle: puzzle!,
          userSteps: stepsWithLast,
          userFinalExpr: resultExpr,
          solutions: solutionsReady ? currentSolutions : [],
          solvedAtMs: elapsed,
          sessionIndex: idx,
          solutionsPending: !solutionsReady,
        };
        setSolved((prev) => [...prev, record]);
        setSolvedCount((prev) => prev + 1);
        setScreen("review");
        if (mode === "sprint" && sprintSessionId && sprintPuzzleIdx) {
          fetch(buildApiUrl("/api/sprint/mark", target), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: sprintSessionId,
              idx: sprintPuzzleIdx,
              outcome: "solved",
              finalExpr: resultExpr,
            }),
          }).catch(() => {});
        }
      }
    }
  };

  const handleOpClick = (op: Op) => {
    if (selectedTile === null) return;
    // Toggle: if clicking the same operator, deselect it
    if (selectedOp === op) {
      setSelectedOp(null);
    } else {
      setSelectedOp(op);
    }
  };

  const handleUndo = () => {
    if (historyStack.length === 0) return;
    const prev = historyStack[historyStack.length - 1];
    setBoard(prev);
    setHistoryStack((h) => h.slice(0, -1));
    setStepStack((s) => s.slice(0, -1));
    setSelectedTile(null);
    setSelectedOp(null);
  };

  const handleContinue = () => {
    if (mode === "sprint" && sprintRemainingMs <= 0) {
      finishSoloSession();
      return;
    }

    if (mode === "sprint" && sprintSessionId && sprintPuzzleIdx != null) {
      // Ask the server for the next puzzle. The server picks the band (advancing
      // it only on solves) and generates the goal/cards; the client cannot
      // influence them. Show the loading state while we wait.
      setScreen("play");
      setPuzzle(null);
      setBoard(null);
      setCurrentSolutions([]);
      setSolutionsReady(false);
      setHistoryStack([]);
      setStepStack([]);
      setSelectedTile(null);
      setSelectedOp(null);
      setGenerating(true);
      setTimerRunning(false);
      skipDebounceRef.current = 0;

      (async () => {
        try {
          const res = await fetch(buildApiUrl("/api/sprint/next", target), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: sprintSessionId }),
          });
          const data = (await res.json()) as {
            idx?: number;
            goal?: number;
            cards?: number[];
            endsAt?: number;
            error?: string;
          };
          if (
            !res.ok ||
            data.idx == null ||
            data.goal == null ||
            !Array.isArray(data.cards)
          ) {
            // Session ended or failed – end the sprint gracefully.
            finishSoloSession();
            return;
          }

          const puzzleForPlay: Puzzle = {
            goal: data.goal,
            cards: data.cards,
            n: data.cards.length,
          };

          const b = makeBoardFromPuzzle(puzzleForPlay);
          setSprintPuzzleIdx(data.idx);
          setPuzzle(puzzleForPlay);
          setBoard(b);
          setGenerating(false);
          setTimerRunning(true);

          // Kick off full solution enumeration for the new puzzle.
          const id = ++solveAbortRef.current;
          if (workerRef.current) {
            workerBusyRef.current = true;
            workerRef.current.postMessage({
              type: "solveAll",
              id,
              cards: puzzleForPlay.cards,
              goal: puzzleForPlay.goal,
            });
          } else {
            setTimeout(() => {
              if (solveAbortRef.current !== id) return;
              const solutions = solve(puzzleForPlay.cards, puzzleForPlay.goal);
              if (solveAbortRef.current !== id) return;
              setCurrentSolutions(solutions);
              setSolutionsReady(true);
            }, 0);
          }
        } catch {
          finishSoloSession();
        }
      })();
      return;
    }
    setScreen("play");
    startNewPuzzle();
  };

  const handleSkip = useCallback(() => {
    if (mode === "multiplayer") return;
    if (!puzzle || !board) return;
    const now = Date.now();
    if (now - skipDebounceRef.current < 400) return;
    skipDebounceRef.current = now;
    setSkippedCount((c) => c + 1);
    if (mode === "sprint" && sprintSessionId && sprintPuzzleIdx) {
      fetch(buildApiUrl("/api/sprint/mark", target), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sprintSessionId,
          idx: sprintPuzzleIdx,
          outcome: "skipped",
        }),
      })
        .then(() => {
          // Ignore server endsAt for local display; we already applied the 20s penalty
          // immediately below to keep client and displayed timer in sync.
        })
        .catch(() => {});
      // Apply the 20s penalty immediately on the client so the timer updates
      // without waiting for the network round-trip.
      setSprintRemainingMs((prev) => Math.max(0, prev - 20000));
    } else if (mode === "sprint") {
      setSprintRemainingMs((prev) => Math.max(0, prev - 20000));
    }
    setTimerRunning(false);
    setStepStack([]);
    if (puzzle) {
      const idx = sessionIndexRef.current++;
      setSkipped((prev) => [
        ...prev,
        {
          puzzle,
          solutions: solutionsReady ? currentSolutions : [],
          sessionIndex: idx,
          solutionsPending: !solutionsReady,
        },
      ]);
    }
    setScreen("review");
  }, [puzzle, board, mode, solutionsReady, currentSolutions, sprintSessionId, sprintPuzzleIdx, target]);

  const handleHome = () => {
    setScreen("home");
    setTimerRunning(false);
  };

  useEffect(() => {
    if (!mpPopup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setMpPopup(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mpPopup]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }

      const rawKey = e.key;

      if (mpHostLeaveOpen) {
        if (rawKey === "Escape") {
          e.preventDefault();
          setMpHostLeaveOpen(false);
        }
        return;
      }
      if (mpEndConfirmOpen) {
        if (rawKey === "Escape") {
          e.preventDefault();
          setMpEndConfirmOpen(false);
        }
        return;
      }

      // Review: space = Continue
      if (screen === "review" && rawKey === " ") {
        e.preventDefault();
        handleContinue();
        return;
      }

      if (screen !== "play") return;

      if (isUndoKey(rawKey)) {
        e.preventDefault();
        handleUndo();
        return;
      }

      if (isSkipKey(rawKey)) {
        if (mode === "multiplayer") return;
        e.preventDefault();
        handleSkip();
        return;
      }

      const code = e.code;

      const tileIndex = cardIndexFromCode(code, numpadCardLayout);
      if (tileIndex != null) {
        if (!board) return;
        if (tileIndex < 0 || tileIndex >= board.tiles.length) return;
        if (!board.tiles[tileIndex].alive) return;
        e.preventDefault();
        handleTileClick(tileIndex);
        return;
      }

      const op = opFromCode(code);
      if (op) {
        e.preventDefault();
        handleOpClick(op);
        return;
      }

    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [screen, board, mode, numpadCardLayout, handleTileClick, handleOpClick, handleUndo, handleSkip, handleContinue, mpHostLeaveOpen, mpEndConfirmOpen]);

  const timerDisplay =
    mode === "practice" && !waitingPractice
      ? formatTime(playElapsedMs)
      : formatTime(sprintRemainingMs);

  const mpLeaderNote =
    waitingPractice && mpRoom ? "Waiting for round to end" : null;

  const mpStandings = (() => {
    if (!mpRoom || (mode !== "multiplayer" && !waitingPractice)) return null;
    const youName = mpRoom.you.name;
    const ranked = [...mpRoom.players]
      .filter((p) => p.participated)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (a.scoreReachedAt ?? Number.MAX_SAFE_INTEGER) -
            (b.scoreReachedAt ?? Number.MAX_SAFE_INTEGER)
      );
    const you =
      ranked.find((p) => p.name === youName) ??
      (mpRoom.you.participated
        ? { name: youName, score: mpRoom.you.score }
        : null);

    const toRow = (p: { name: string; score: number }) => ({
      name: p.name,
      score: p.score,
      isYou: p.name === youName,
    });

    if (ranked.length === 0) return you ? [toRow(you)] : null;
    if (ranked.every((p) => p.score === 0)) {
      return you ? [toRow({ name: youName, score: 0 })] : null;
    }

    const top = ranked.slice(0, 3);
    const rows = top.map(toRow);
    if (you && !top.some((p) => p.name === youName)) {
      rows.push(toRow(you));
    }
    return rows;
  })();

  const mpPlayNotice = mpActionError;

  const showHostEndRound =
    mode === "multiplayer" && !waitingPractice && !!mpRoom?.you.isHost;

  const hostEndRoundUi = showHostEndRound && mpEndConfirmOpen ? (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-30">
      <div className="bg-white rounded-2xl w-full max-w-sm p-4">
        <div className="font-semibold mb-1">End this round?</div>
        <p className="text-sm text-neutral-500 mb-4">
          Everyone will go to results with their scores so far. This cannot be undone.
        </p>
        <button
          type="button"
          disabled={mpEnding}
          onClick={() => void mpEndRound()}
          className="w-full h-12 mb-2 rounded-xl bg-neutral-900 text-white font-medium disabled:bg-neutral-200 disabled:text-neutral-500"
        >
          {mpEnding ? "Ending…" : "End round"}
        </button>
        <button
          type="button"
          disabled={mpEnding}
          onClick={() => setMpEndConfirmOpen(false)}
          className="w-full h-11 rounded-xl border border-neutral-200 text-sm text-neutral-500"
        >
          Cancel
        </button>
      </div>
    </div>
  ) : null;

  const sessionLeaveUi = (
    <>
      {mpHostLeaveOpen && mpRoom && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-30"
          onClick={() => setMpHostLeaveOpen(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-semibold mb-1">Choose a new host</div>
            <p className="text-sm text-neutral-500 mb-3">
              Pick who should host after you leave.
            </p>
            <div className="flex flex-col gap-2 mb-3">
              {mpRoom.players
                .filter((p) => p.id && p.id !== mpRoom.you.playerId)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setMpHostLeaveOpen(false);
                      void mpLeave(p.id);
                    }}
                    className="w-full h-11 rounded-xl border border-neutral-300 text-sm font-medium"
                  >
                    {p.name}
                  </button>
                ))}
            </div>
            <button
              type="button"
              onClick={() => setMpHostLeaveOpen(false)}
              className="w-full h-11 rounded-xl border border-neutral-200 text-sm text-neutral-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {mpPopup && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-30"
          onClick={() => setMpPopup(null)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-semibold mb-4">{mpPopup.title}</div>
            {mpPopup.body ? (
              <p className="text-sm text-neutral-500 mb-4">{mpPopup.body}</p>
            ) : null}
            <button
              type="button"
              onClick={() => setMpPopup(null)}
              className="w-full h-12 rounded-xl bg-neutral-900 text-white font-medium"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </>
  );

  // HOME
  if (screen === "home") {
    return (
      <>
      <div className="fixed inset-0 flex flex-col items-center justify-center px-6 overflow-y-auto"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <h1 className="text-6xl sm:text-7xl md:text-8xl font-bold mb-6">67</h1>
        <p className="text-neutral-600 text-lg text-center max-w-sm mb-6 leading-relaxed">
          Combine all cards with + − × ÷ to reach the target.
          <br />
          <span className="text-neutral-500">Use every number exactly once.</span>
        </p>
        <div className="text-neutral-500 text-sm max-w-sm mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 mx-auto w-fit">
          <span className="font-semibold text-right block">Target:</span>
          <span className="text-left">Random number from 1–200.</span>
          <span className="font-semibold text-right block">Cards:</span>
          <span className="text-left">Numbered 1–13.</span>
          <span className="font-semibold text-right block">Number of cards:</span>
          <span className="text-left">4 if &lt; 67, 5 if &lt; 67 × 2, 6 otherwise.</span>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={() => startSession("practice")}
            className="h-14 sm:h-16 border-2 border-neutral-900 text-neutral-900 rounded-xl font-medium text-lg sm:text-xl active:bg-neutral-100 transition-colors"
          >
            Practice
          </button>
          <button
            onClick={() => {
              setHomePopup(null);
              setScreen("mp-hub");
            }}
            className="h-14 sm:h-16 border-2 border-neutral-900 text-neutral-900 rounded-xl font-medium text-lg sm:text-xl active:bg-neutral-100 transition-colors"
          >
            Multiplayer
          </button>
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <button
                onClick={() => startSession("sprint")}
                className="w-full h-14 sm:h-16 border-2 border-neutral-900 text-neutral-900 rounded-xl font-medium text-sm sm:text-base active:bg-neutral-100 transition-colors"
              >
                5-min Sprint
              </button>
              <SprintInfoHint />
            </div>
            <button
              onClick={() => setScreen("leaderboard")}
              className="h-14 sm:h-16 border-2 border-neutral-900 text-neutral-900 rounded-xl font-medium text-sm sm:text-base active:bg-neutral-100 transition-colors"
            >
              Leaderboard
            </button>
          </div>
          {isDev && (
            <Link
              href="/admin"
              className="h-12 flex items-center justify-center border-2 border-neutral-300 text-neutral-700 rounded-xl font-medium active:bg-neutral-100 transition-colors"
            >
              Admin
            </Link>
          )}
        </div>
        {isDev && (
          <div className="mt-6 flex flex-col items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              Data source
            </span>
            <div className="inline-flex rounded-xl border border-neutral-200 bg-neutral-50 p-0.5 text-sm">
              {(["local", "production"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTarget(t)}
                  className={`px-4 py-1.5 rounded-lg transition-colors ${
                    target === t
                      ? "bg-neutral-900 text-white"
                      : "text-neutral-600 hover:bg-neutral-100"
                  }`}
                >
                  {t === "local" ? "Local" : "Actual"}
                </button>
              ))}
            </div>
            <span className="text-xs text-neutral-400">
              {target === "production"
                ? "Playing & scores hit the live site."
                : "Playing & scores stay on your machine."}
            </span>
          </div>
        )}
      </div>
      {homePopup && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-30"
          onClick={() => setHomePopup(null)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-semibold mb-1">{homePopup.title}</div>
            {homePopup.body ? (
              <p className="text-sm text-neutral-500 mb-4">{homePopup.body}</p>
            ) : (
              <div className="mb-4" />
            )}
            <button
              type="button"
              onClick={() => setHomePopup(null)}
              className="w-full h-12 rounded-xl bg-neutral-900 text-white font-medium"
            >
              OK
            </button>
          </div>
        </div>
      )}
      </>
    );
  }

  // MULTIPLAYER HUB
  if (screen === "mp-hub") {
    return (
      <MultiplayerHub
        target={target}
        initialRoomName={mpPrefillRoom}
        onEntered={mpEntered}
        onBack={() => {
          setMpPrefillRoom(null);
          if (typeof window !== "undefined") window.history.replaceState(null, "", "/");
          setScreen("home");
        }}
      />
    );
  }

  // MULTIPLAYER LOBBY
  if (screen === "mp-lobby" && mpRoom) {
    return (
      <>
        <RoomLobby
          room={mpRoom}
          onStart={() => void mpStart()}
          onSetDuration={(ms) => void mpSetDuration(ms)}
          onLeave={(newHostId) => void mpLeave(newHostId)}
          onKick={(id) => void mpKick(id)}
          starting={mpStarting}
          actionError={mpActionError}
        />
        {sessionLeaveUi}
      </>
    );
  }

  // MULTIPLAYER WAITING
  if (screen === "mp-wait" && mpRoom) {
    return (
      <>
        <RoomWaiting
          roomName={mpRoom.name}
          timerDisplay={timerDisplay}
          waitingOnly={mpWaitIdle}
          standings={mpStandings}
          onPractice={() => {
            setMpWaitIdle(false);
            setWaitingPractice(true);
            waitingPracticeRef.current = true;
            setMode("practice");
            setSolvedCount(0);
            setSkippedCount(0);
            setSolved([]);
            setSkipped([]);
            sessionIndexRef.current = 1;
            setPlayElapsedMs(0);
            setScreen("play");
            startNewPuzzle();
          }}
          onWait={() => setMpWaitIdle(true)}
          onLeave={handleQuit}
        />
        {sessionLeaveUi}
      </>
    );
  }

  // MULTIPLAYER RESULTS
  if (screen === "mp-results" && mpRoom) {
    return (
      <>
        <RoomResults
          room={mpRoom}
          onStart={() => void mpStart()}
          onSetDuration={(ms) => void mpSetDuration(ms)}
          onLeave={(newHostId) => void mpLeave(newHostId)}
          onKick={(id) => void mpKick(id)}
          starting={mpStarting}
          actionError={mpActionError}
        />
        {sessionLeaveUi}
      </>
    );
  }

  // LEADERBOARD
  if (screen === "leaderboard") {
    return (
      <LeaderboardView
        onBack={handleHome}
        target={target}
        initialEntries={leaderboardCacheRef.current ?? undefined}
      />
    );
  }

  // SUMMARY
  if (screen === "summary") {
    const totalTime =
      mode === "practice" ? playElapsedMs : SPRINT_DURATION_MS - sprintRemainingMs;
    return (
      <SummaryView
        mode={mode}
        solved={solved}
        skipped={skipped}
        useFaceCards={useFaceCards}
        target={target}
        leaderboardSessionId={mode === "sprint" ? sprintSessionId : null}
        solvedCount={solvedCount}
        skippedCount={skippedCount}
        totalTimeMs={totalTime}
        onHome={handleHome}
      />
    );
  }

  // REVIEW
  if (screen === "review" && puzzle) {
    const isSprintEnding =
      mode === "sprint" && sprintRemainingMs <= 0;

    return (
      <div className="fixed inset-0 flex flex-col">
        <TopBar
          solvedCount={solvedCount}
          timerDisplay={timerDisplay}
          onQuit={handleQuit}
          showShortcuts={showShortcuts}
          quitLabel={mpPlayerId ? "Leave" : "Quit"}
          leaderNote={mpLeaderNote}
          standings={mpStandings}
          notice={mpPlayNotice}
        />
        <div className="flex-1 overflow-y-auto">
          <ReviewPanel
            goal={puzzle.goal}
            cards={puzzle.cards}
            useFaceCards={useFaceCards}
            steps={stepStack}
            solutions={currentSolutions}
            solutionsReady={solutionsReady}
            onContinue={handleContinue}
            showShortcuts={showShortcuts}
            isSprintEnding={isSprintEnding}
          />
        </div>
        {sessionLeaveUi}
      </div>
    );
  }

  // PLAY (loading: waiting for first puzzle)
  if (screen === "play" && (!board || !puzzle)) {
    return (
      <div className="fixed inset-0 flex flex-col">
        <TopBar
          solvedCount={solvedCount}
          timerDisplay={timerDisplay}
          onQuit={handleQuit}
          onEndRound={showHostEndRound ? () => setMpEndConfirmOpen(true) : undefined}
          showShortcuts={showShortcuts}
          quitLabel={mpPlayerId ? "Leave" : "Quit"}
          leaderNote={mpLeaderNote}
          standings={mpStandings}
          notice={mpPlayNotice}
        />
        {hostEndRoundUi}
        {sessionLeaveUi}
        <div className="flex-1 flex items-center justify-center">
          <span className="text-neutral-400 text-sm">Generating next problem…</span>
        </div>
      </div>
    );
  }

  // PLAY (ready)
  if (screen === "play" && board && puzzle) {
    const aliveCount = board.tiles.filter((t) => t.alive).length;
    const wrongAnswer =
      aliveCount === 1 &&
      !eq(board.tiles.filter((t) => t.alive)[0].value, rat(puzzle.goal));

    return (
      <div className="fixed inset-0 flex flex-col relative">
        <TopBar
          solvedCount={solvedCount}
          timerDisplay={timerDisplay}
          onQuit={handleQuit}
          onEndRound={showHostEndRound ? () => setMpEndConfirmOpen(true) : undefined}
          showShortcuts={showShortcuts}
          quitLabel={mpPlayerId ? "Leave" : "Quit"}
          leaderNote={mpLeaderNote}
          standings={mpStandings}
          notice={mpPlayNotice}
        />
        {hostEndRoundUi}
        {sessionLeaveUi}

        {generating ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-neutral-400 text-sm">Generating next problem…</span>
          </div>
        ) : (
          <div className="flex-1 flex flex-col" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0.75rem))" }}>
            {/* Goal */}
            <GoalDisplay goal={puzzle.goal} />

            {/* Cards */}
            <CardGrid
              tiles={board.tiles}
              selectedIndex={selectedTile}
              hasOp={selectedOp !== null}
              onTileClick={handleTileClick}
              useFaceCards={useFaceCards}
              showShortcuts={showShortcuts}
              numpadCardLayout={numpadCardLayout}
              highlightWrong={wrongAnswer}
            />

            {/* Ops */}
            <OpRow
              selectedOp={selectedOp}
              disabled={selectedTile === null}
              onOpClick={handleOpClick}
              showShortcuts={showShortcuts}
            />

            {/* Actions */}
            <div className="flex gap-2.5 px-4 pb-2 max-w-sm mx-auto w-full">
              <button
                onClick={handleUndo}
                disabled={historyStack.length === 0}
                className="flex-1 min-w-0 h-16 text-base sm:text-lg font-medium rounded-xl border-2 border-neutral-200 text-neutral-500 active:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <div className="flex flex-col items-center justify-center leading-tight">
                  {showShortcuts && (
                    <span className="text-[11px] text-neutral-400">{UNDO_KEY}</span>
                  )}
                  <span>Undo</span>
                </div>
              </button>
              {mode !== "multiplayer" && (
              <button
                onClick={handleSkip}
                className="flex-1 min-w-0 h-16 text-base sm:text-lg font-medium rounded-xl border-2 border-neutral-300 text-neutral-600 active:bg-neutral-100 transition-colors"
              >
                <div className="flex flex-col items-center justify-center leading-tight">
                  {showShortcuts && (
                    <span className="text-[11px] text-neutral-400">{SKIP_KEY}</span>
                  )}
                  <span className="text-sm sm:text-base">
                    {mode === "sprint" ? "Skip (-20 sec)" : "Skip"}
                  </span>
                </div>
              </button>
              )}
            </div>

            {/* Toggles */}
            <div className="px-4 pb-3 max-w-sm mx-auto w-full text-sm text-neutral-600">
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    setShowShortcuts((v) => !v);
                    (e.currentTarget as HTMLButtonElement).blur();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-neutral-200 bg-white active:bg-neutral-50 focus:outline-none focus-visible:outline-none"
                >
                  <span>Show keyboard shortcuts</span>
                  <span
                    aria-hidden
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      showShortcuts ? "bg-neutral-900" : "bg-neutral-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        showShortcuts ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </span>
                </button>

                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    setNumpadCardLayout((v) => !v);
                    (e.currentTarget as HTMLButtonElement).blur();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-neutral-200 bg-white active:bg-neutral-50 focus:outline-none focus-visible:outline-none"
                >
                  <span>Numpad layout for card shortcuts</span>
                  <span
                    aria-hidden
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      numpadCardLayout ? "bg-neutral-900" : "bg-neutral-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        numpadCardLayout ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </span>
                </button>
              </div>
            </div>

            {/* Steps trail */}
            {stepStack.length > 0 && (
              <div className="px-4 pt-2 pb-1 max-w-sm mx-auto w-full">
                <div className="text-[11px] uppercase tracking-widest text-neutral-300 mb-0.5">
                  Steps
                </div>
                {stepStack.map((step, i) => (
                  <div key={i} className="text-xs font-mono text-neutral-400 leading-relaxed">
                    {step.aExpr} {OP_DISPLAY[step.op]} {step.bExpr} = {ratToString(step.resultValue)}
                  </div>
                ))}
              </div>
            )}

          </div>
        )}

      </div>
    );
  }

  return null;
}
