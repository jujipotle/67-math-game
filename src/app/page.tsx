"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
} from "@/lib/types";
import { rat, applyOp, eq, ratToString } from "@/lib/rational";
import { solve } from "@/lib/solver";
import { generatePuzzle } from "@/lib/generator";
import { saveSession } from "@/lib/storage";
import TopBar from "@/components/TopBar";
import GoalDisplay from "@/components/GoalDisplay";
import CardGrid from "@/components/CardGrid";
import OpRow from "@/components/OpRow";
import ReviewPanel from "@/components/ReviewPanel";
import SummaryView from "@/components/SummaryView";
import LeaderboardView from "@/components/LeaderboardView";

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

export default function Home() {
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
  const [useNumpadMapping, setUseNumpadMapping] = useState(false);
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

  const QUEUE_TARGET = 4;

  useEffect(() => {
    if (screen !== "home") return;
    let cancelled = false;
    fetch("/api/leaderboard", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { entries?: { id: number; name: string; score: number; createdAt: number }[] }) => {
        if (!cancelled && data?.entries) leaderboardCacheRef.current = data.entries;
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [screen]);

  useEffect(() => {
    if (!timerRunning) return;
    lastTickRef.current = performance.now();

    const interval = setInterval(() => {
      const now = performance.now();
      let dt = now - lastTickRef.current;
      lastTickRef.current = now;
      // Cap dt to prevent tab throttling from eating time in one tick
      if (dt > 2000) dt = 2000;

      if (mode === "practice") {
        setPlayElapsedMs((prev) => prev + dt);
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
  }, [timerRunning, mode]);

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
        const hasCached = puzzleQueueRef.current.length > 0;
        if (!hasCached) setGenerating(true);
        setTimerRunning(false);
        (async () => {
          try {
            const res = await fetch("/api/sprint/start", { method: "POST" });
            const data = (await res.json()) as {
              sessionId?: string;
              endsAt?: number;
              error?: string;
            };
            if (!res.ok || !data.sessionId || data.endsAt == null) {
              throw new Error(data.error || "Failed to start sprint");
            }

            let puzzleForPlay: Puzzle = puzzleQueueRef.current.shift()!;
            if (!puzzleForPlay) {
              puzzleForPlay = generatePuzzle();
            }

            const registerRes = await fetch("/api/sprint/register", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: data.sessionId,
                idx: 1,
                goal: puzzleForPlay.goal,
                cards: puzzleForPlay.cards,
              }),
            });
            if (!registerRes.ok) throw new Error("Failed to register puzzle");

            setSprintSessionId(data.sessionId);
            setSprintPuzzleIdx(1);
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
            refillPuzzleQueue();

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
    [startNewPuzzle]
  );

  const handleQuit = useCallback(() => {
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

  const handleTimeUp = useCallback(() => {
    setTimerRunning(false);
    if (mode === "sprint" && sprintSessionId && sprintPuzzleIdx) {
      fetch("/api/sprint/mark", {
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
  }, [mode, puzzle, solutionsReady, currentSolutions, sprintSessionId, sprintPuzzleIdx]);

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
          fetch("/api/sprint/mark", {
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
    setSelectedOp(op);
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

  const handleReset = () => {
    if (!puzzle) return;
    setBoard(makeBoardFromPuzzle(puzzle));
    setHistoryStack([]);
    setStepStack([]);
    setSelectedTile(null);
    setSelectedOp(null);
  };

  const handleContinue = () => {
    if (mode === "sprint" && sprintRemainingMs <= 0) {
      handleQuit();
      return;
    }

    if (mode === "sprint" && sprintSessionId && sprintPuzzleIdx != null) {
      const nextIdx = sprintPuzzleIdx + 1;
      // Get the next puzzle immediately (from cache or freshly generated)
      // so we can show it without waiting for the /api/sprint/register call.
      let puzzleForPlay: Puzzle | undefined = puzzleQueueRef.current.shift();
      if (!puzzleForPlay) puzzleForPlay = generatePuzzle();

      setScreen("play");
      const b = makeBoardFromPuzzle(puzzleForPlay);
      setSprintPuzzleIdx(nextIdx);
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
          const solutions = solve(puzzleForPlay!.cards, puzzleForPlay!.goal);
          if (solveAbortRef.current !== id) return;
          setCurrentSolutions(solutions);
          setSolutionsReady(true);
        }, 0);
      }

      // Register the puzzle with the sprint session in the background.
      (async () => {
        try {
          const registerRes = await fetch("/api/sprint/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: sprintSessionId,
              idx: nextIdx,
              goal: puzzleForPlay.goal,
              cards: puzzleForPlay.cards,
            }),
          });
          if (!registerRes.ok) {
            // If registration fails, end the sprint gracefully.
            handleQuit();
          }
        } catch {
          handleQuit();
        }
      })();
      return;
    }
    setScreen("play");
    startNewPuzzle();
  };

  const handleSkip = useCallback(() => {
    if (!puzzle || !board) return;
    const now = Date.now();
    if (now - skipDebounceRef.current < 400) return;
    skipDebounceRef.current = now;
    setSkippedCount((c) => c + 1);
    if (mode === "sprint" && sprintSessionId && sprintPuzzleIdx) {
      fetch("/api/sprint/mark", {
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
  }, [puzzle, board, mode, solutionsReady, currentSolutions, sprintSessionId, sprintPuzzleIdx]);

  const handleHome = () => {
    setScreen("home");
    setTimerRunning(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }

      const rawKey = e.key;
      const key = rawKey.toLowerCase();

      // Global quit from play/review: Escape
      if ((screen === "play" || screen === "review") && (rawKey === "Escape" || key === "escape")) {
        e.preventDefault();
        handleQuit();
        return;
      }

      // Review: space = Continue
      if (screen === "review" && rawKey === " ") {
        e.preventDefault();
        handleContinue();
        return;
      }

      if (screen !== "play") return;

      // Card selection: 1-6 map to the 6 card slots (top row 1–3, bottom row 4–6).
      if (key >= "1" && key <= "6") {
        if (!board) return;
        const n = Number(key);
        let index: number | null = null;
        if (useNumpadMapping) {
          // Numpad-style: 1–3 bottom row, 4–6 top row (all left→right)
          const map: (number | null)[] = [null, 3, 4, 5, 0, 1, 2];
          index = map[n] ?? null;
        } else {
          // Default: 1–3 top row, 4–6 bottom row (all left→right)
          index = n - 1;
        }
        if (index == null) return;
        if (index < 0 || index >= board.tiles.length) return;
        if (!board.tiles[index].alive) return;
        e.preventDefault();
        handleTileClick(index);
        return;
      }

      // Ops: q=+, w=−, e=×, r=÷
      if (key === "q") {
        e.preventDefault();
        handleOpClick("+");
        return;
      }
      if (key === "w") {
        e.preventDefault();
        handleOpClick("-");
        return;
      }
      if (key === "e") {
        e.preventDefault();
        handleOpClick("*");
        return;
      }
      if (key === "r") {
        e.preventDefault();
        handleOpClick("/");
        return;
      }

      // Actions primary: a=undo, s=reset, d=skip
      if (key === "a") {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (key === "s") {
        e.preventDefault();
        handleReset();
        return;
      }
      if (key === "d") {
        e.preventDefault();
        handleSkip();
        return;
      }

    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [screen, board, useNumpadMapping, handleQuit, handleTileClick, handleOpClick, handleUndo, handleReset, handleSkip, handleContinue]);

  const timerDisplay =
    mode === "practice" ? formatTime(playElapsedMs) : formatTime(sprintRemainingMs);

  // HOME
  if (screen === "home") {
    return (
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
            className="h-14 sm:h-16 bg-neutral-900 text-white rounded-xl font-medium text-lg sm:text-xl active:bg-neutral-700 transition-colors"
          >
            Practice
          </button>
          <button
            onClick={() => startSession("sprint")}
            className="h-14 sm:h-16 border-2 border-neutral-900 text-neutral-900 rounded-xl font-medium text-lg sm:text-xl active:bg-neutral-100 transition-colors"
          >
            5-Minute Sprint
          </button>
          <button
            onClick={() => setScreen("leaderboard")}
            className="h-12 border-2 border-neutral-300 text-neutral-700 rounded-xl font-medium active:bg-neutral-100 transition-colors"
          >
            Leaderboard
          </button>
        </div>
      </div>
    );
  }

  // LEADERBOARD
  if (screen === "leaderboard") {
    return (
      <LeaderboardView
        onBack={handleHome}
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
          onQuit={handleHome}
          showShortcuts={showShortcuts}
        />
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
          showShortcuts={showShortcuts}
        />

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
              onTileClick={handleTileClick}
              useFaceCards={useFaceCards}
              showShortcuts={showShortcuts}
              highlightWrong={wrongAnswer}
              useNumpadMapping={useNumpadMapping}
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
                    <span className="text-[11px] text-neutral-400">a</span>
                  )}
                  <span>Undo</span>
                </div>
              </button>
              <button
                onClick={handleReset}
                className="flex-1 min-w-0 h-16 text-base sm:text-lg font-medium rounded-xl border-2 border-neutral-200 text-neutral-500 active:bg-neutral-100 transition-colors"
              >
                <div className="flex flex-col items-center justify-center leading-tight">
                  {showShortcuts && (
                    <span className="text-[11px] text-neutral-400">s</span>
                  )}
                  <span>Reset</span>
                </div>
              </button>
              <button
                onClick={handleSkip}
                className="flex-1 min-w-0 h-16 text-base sm:text-lg font-medium rounded-xl border-2 border-neutral-300 text-neutral-600 active:bg-neutral-100 transition-colors"
              >
                <div className="flex flex-col items-center justify-center leading-tight">
                  {showShortcuts && (
                    <span className="text-[11px] text-neutral-400">d</span>
                  )}
                  <span className="text-sm sm:text-base">
                    {mode === "sprint" ? "Skip (-20 sec)" : "Skip"}
                  </span>
                </div>
              </button>
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
                    setUseNumpadMapping((v) => !v);
                    (e.currentTarget as HTMLButtonElement).blur();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-neutral-200 bg-white active:bg-neutral-50 focus:outline-none focus-visible:outline-none"
                >
                  <span>Use numpad for cards</span>
                  <span
                    aria-hidden
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      useNumpadMapping ? "bg-neutral-900" : "bg-neutral-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        useNumpadMapping ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </span>
                </button>

                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    setUseFaceCards((v) => !v);
                    (e.currentTarget as HTMLButtonElement).blur();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-neutral-200 bg-white active:bg-neutral-50 focus:outline-none focus-visible:outline-none"
                >
                  <span>Show A / J / Q / K</span>
                  <span
                    aria-hidden
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      useFaceCards ? "bg-neutral-900" : "bg-neutral-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        useFaceCards ? "translate-x-5" : "translate-x-1"
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
