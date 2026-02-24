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
  const [sprintSessionId, setSprintSessionId] = useState<string | null>(null);
  const [sprintPuzzleIdx, setSprintPuzzleIdx] = useState<number | null>(null);
  const [playElapsedMs, setPlayElapsedMs] = useState(0);
  const [sprintRemainingMs, setSprintRemainingMs] = useState(SPRINT_DURATION_MS);
  const [timerRunning, setTimerRunning] = useState(false);
  const [currentSolutions, setCurrentSolutions] = useState<string[]>([]);
  const [solutionsReady, setSolutionsReady] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pendingSolved, setPendingSolved] = useState<{
    puzzle: Puzzle;
    steps: Step[];
    resultExpr: string;
    elapsed: number;
  } | null>(null);
  const [pendingSkip, setPendingSkip] = useState<{ puzzle: Puzzle } | null>(null);

  const lastTickRef = useRef<number>(0);
  const solveAbortRef = useRef(0);
  const puzzleQueueRef = useRef<Puzzle[]>([]);
  const queueGenerationInFlightRef = useRef(false);
  const workerRef = useRef<Worker | null>(null);
  const workerBusyRef = useRef(false);
  const skipDebounceRef = useRef(0);
  const sessionIndexRef = useRef(1);
  const leaderboardCacheRef = useRef<{ id: number; name: string; score: number; createdAt: number }[] | null>(null);

  const QUEUE_TARGET = 2;

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
    if (workerRef.current) {
      workerRef.current.postMessage({ type: "preGenerate" });
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
    } catch {
      workerRef.current = null;
    }
    return () => workerRef.current?.terminate();
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
      setPendingSolved(null);
      setPendingSkip(null);
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
      setPendingSolved(null);
      setPendingSkip(null);
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
            setPendingSolved(null);
            setPendingSkip(null);
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
    if (solutionsReady && puzzle) {
      const idx = sessionIndexRef.current++;
      setSkipped((prev) => [...prev, { puzzle, solutions: currentSolutions, sessionIndex: idx }]);
    } else if (puzzle) {
      setPendingSkip({ puzzle });
    }
    setScreen("review");
  }, [mode, puzzle, solutionsReady, currentSolutions, sprintSessionId, sprintPuzzleIdx]);

  useEffect(() => {
    if (mode === "sprint" && sprintRemainingMs <= 0 && screen === "play") {
      handleTimeUp();
    }
  }, [sprintRemainingMs, screen, mode, handleTimeUp]);

  useEffect(() => {
    if (!solutionsReady) return;
    if (pendingSolved) {
      const { puzzle, steps, resultExpr, elapsed } = pendingSolved;
      const idx = sessionIndexRef.current++;
      const record: SolvedRecord = {
        puzzle,
        userSteps: steps,
        userFinalExpr: resultExpr,
        solutions: currentSolutions,
        solvedAtMs: elapsed,
        sessionIndex: idx,
      };
      setSolved((prev) => [...prev, record]);
      setSolvedCount((prev) => prev + 1);
      setPendingSolved(null);
    } else if (pendingSkip) {
      const idx = sessionIndexRef.current++;
      setSkipped((prev) => [...prev, { puzzle: pendingSkip.puzzle, solutions: currentSolutions, sessionIndex: idx }]);
      setPendingSkip(null);
    }
  }, [solutionsReady, pendingSolved, pendingSkip, currentSolutions]);

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
        if (solutionsReady) {
          const idx = sessionIndexRef.current++;
          const record: SolvedRecord = {
            puzzle: puzzle!,
            userSteps: stepsWithLast,
            userFinalExpr: resultExpr,
            solutions: currentSolutions,
            solvedAtMs: elapsed,
            sessionIndex: idx,
          };
          setSolved((prev) => [...prev, record]);
          setSolvedCount((prev) => prev + 1);
        } else {
          setPendingSolved({
            puzzle: puzzle!,
            steps: stepsWithLast,
            resultExpr,
            elapsed,
          });
        }
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
    setScreen("play");
    if (mode === "sprint" && sprintSessionId && sprintPuzzleIdx != null) {
      setPuzzle(null);
      setBoard(null);
      setTimerRunning(false);
      const nextIdx = sprintPuzzleIdx + 1;
      (async () => {
        try {
          let puzzleForPlay: Puzzle | undefined = puzzleQueueRef.current.shift();
          if (!puzzleForPlay) puzzleForPlay = generatePuzzle();

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
            handleQuit();
            return;
          }

          setSprintPuzzleIdx(nextIdx);
          const b = makeBoardFromPuzzle(puzzleForPlay);
          setPuzzle(puzzleForPlay);
          setBoard(b);
          setCurrentSolutions([]);
          setSolutionsReady(false);
          setPendingSolved(null);
          setPendingSkip(null);
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
              const solutions = solve(puzzleForPlay!.cards, puzzleForPlay!.goal);
              if (solveAbortRef.current !== id) return;
              setCurrentSolutions(solutions);
              setSolutionsReady(true);
            }, 0);
          }
        } catch {
          handleQuit();
        }
      })();
      return;
    }
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
        .then(async (r) => {
          if (!r.ok) return;
          // Apply exactly 20s penalty locally so we don't add network latency to the penalty
          setSprintRemainingMs((prev) => Math.max(0, prev - 20000));
        })
        .catch(() => {});
    } else if (mode === "sprint") {
      setSprintRemainingMs((prev) => Math.max(0, prev - 20000));
    }
    setTimerRunning(false);
    setStepStack([]);
    if (solutionsReady && puzzle) {
      const idx = sessionIndexRef.current++;
      setSkipped((prev) => [...prev, { puzzle, solutions: currentSolutions, sessionIndex: idx }]);
    } else if (puzzle) {
      setPendingSkip({ puzzle });
    }
    setScreen("review");
  }, [puzzle, board, mode, solutionsReady, currentSolutions, sprintSessionId, sprintPuzzleIdx]);

  const handleHome = () => {
    setScreen("home");
    setTimerRunning(false);
  };

  const timerDisplay =
    mode === "practice" ? formatTime(playElapsedMs) : formatTime(sprintRemainingMs);

  // HOME
  if (screen === "home") {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center px-6 overflow-y-auto"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <h1 className="text-7xl font-bold mb-6">67</h1>
        <p className="text-neutral-600 text-base text-center max-w-sm mb-6 leading-relaxed">
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
        <label className="flex items-center gap-2 text-sm text-neutral-600 mb-6">
          <input
            type="checkbox"
            checked={useFaceCards}
            onChange={(e) => setUseFaceCards(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300 text-neutral-900"
          />
          <span>Show A, J, Q, K for 1, 11, 12, 13</span>
        </label>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={() => startSession("practice")}
            className="h-14 bg-neutral-900 text-white rounded-xl font-medium text-lg active:bg-neutral-700 transition-colors"
          >
            Practice
          </button>
          <button
            onClick={() => startSession("sprint")}
            className="h-14 border-2 border-neutral-900 text-neutral-900 rounded-xl font-medium text-lg active:bg-neutral-100 transition-colors"
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
    return (
      <div className="fixed inset-0 flex flex-col relative">
        <TopBar
          solvedCount={solvedCount}
          timerDisplay={timerDisplay}
          onQuit={handleQuit}
        />
        <div className="flex-1 flex">
          <ReviewPanel
            goal={puzzle.goal}
            cards={puzzle.cards}
            useFaceCards={useFaceCards}
            steps={stepStack}
            solutions={currentSolutions}
            solutionsReady={solutionsReady}
            onContinue={handleContinue}
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
            />

            {/* Ops */}
            <OpRow
              selectedOp={selectedOp}
              disabled={selectedTile === null}
              onOpClick={handleOpClick}
            />

            {/* Actions */}
            <div className="flex gap-2.5 px-4 pb-2 max-w-sm mx-auto w-full">
              <button
                onClick={handleUndo}
                disabled={historyStack.length === 0}
                className="flex-1 min-w-0 h-14 text-base font-medium rounded-xl border-2 border-neutral-200 text-neutral-500 active:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Undo
              </button>
              <button
                onClick={handleReset}
                className="flex-1 min-w-0 h-14 text-base font-medium rounded-xl border-2 border-neutral-200 text-neutral-500 active:bg-neutral-100 transition-colors"
              >
                Reset
              </button>
              <button
                onClick={handleSkip}
                className="flex-1 min-w-0 h-14 text-base font-medium rounded-xl border-2 border-neutral-300 text-neutral-600 active:bg-neutral-100 transition-colors"
              >
                {mode === "sprint" ? "Skip (−20s)" : "Skip"}
              </button>
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

            {/* Wrong answer */}
            {wrongAnswer && (
              <div className="text-center text-sm text-red-500 py-2 px-4">
                Result is{" "}
                {ratToString(board.tiles.filter((t) => t.alive)[0].value)}, not{" "}
                {puzzle.goal}. Undo to try again.
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}
