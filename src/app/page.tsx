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
import { solve, hasSolution } from "@/lib/solver";
import { generatePuzzle } from "@/lib/generator";
import { saveSession } from "@/lib/storage";
import TopBar from "@/components/TopBar";
import GoalDisplay from "@/components/GoalDisplay";
import CardGrid from "@/components/CardGrid";
import OpRow from "@/components/OpRow";
import ReviewPanel from "@/components/ReviewPanel";
import SummaryView from "@/components/SummaryView";

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
  const [pendingSkip, setPendingSkip] = useState(false);

  const lastTickRef = useRef<number>(0);
  const solveAbortRef = useRef(0);
  const nextPuzzleRef = useRef<Puzzle | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerBusyRef = useRef(false);
  const skipDebounceRef = useRef(0);
  const sessionIndexRef = useRef(1);

  useEffect(() => {
    if (!timerRunning) return;
    lastTickRef.current = performance.now();

    const interval = setInterval(() => {
      const now = performance.now();
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;

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

  useEffect(() => {
    try {
      workerRef.current = new Worker(new URL("../workers/puzzle.worker.ts", import.meta.url));
      workerRef.current.onmessage = (
        e: MessageEvent<
          | { kind: "puzzle"; puzzle: Puzzle }
          | { kind: "solutions"; id: number; solutions: string[] }
        >
      ) => {
        workerBusyRef.current = false;
        const msg = e.data;
        if (msg.kind === "puzzle") {
          nextPuzzleRef.current = msg.puzzle;
        } else if (msg.kind === "solutions") {
          if (msg.id !== solveAbortRef.current) return;
          setCurrentSolutions(msg.solutions);
          setSolutionsReady(true);
        }
      };
      workerRef.current.onerror = () => {
        workerBusyRef.current = false;
        workerRef.current = null;
      };
    } catch {
      workerRef.current = null;
    }
    return () => workerRef.current?.terminate();
  }, []);

  const preGenerateNextPuzzle = useCallback(() => {
    if (workerBusyRef.current) return;
    if (workerRef.current) {
      workerBusyRef.current = true;
      workerRef.current.postMessage({ type: "preGenerate" });
    } else {
      setTimeout(() => {
        // Fallback: generate puzzles on the main thread, but only
        // check for the existence of *any* solution before accepting.
        // Full solution enumeration happens later.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const p = generatePuzzle();
          if (hasSolution(p.cards, p.goal)) {
            nextPuzzleRef.current = p;
            break;
          }
        }
      }, 0);
    }
  }, []);

  const startNewPuzzle = useCallback(() => {
    const cached = nextPuzzleRef.current;
    if (cached) {
      nextPuzzleRef.current = null;
      const puzzleForPlay = cached;
      const b = makeBoardFromPuzzle(puzzleForPlay);
      setPuzzle(puzzleForPlay);
      setBoard(b);
      setCurrentSolutions([]);
      setSolutionsReady(false);
      setPendingSolved(null);
      setPendingSkip(false);
      setHistoryStack([]);
      setStepStack([]);
      setSelectedTile(null);
      setSelectedOp(null);
      setGenerating(false);
      setTimerRunning(true);
      preGenerateNextPuzzle();

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
      // Find a solvable puzzle (at least one solution).
      // This intentionally runs on the main thread only when no worker/cached
      // puzzle is available, so you see a "Generating next problem" screen.
      // eslint-disable-next-line no-constant-condition
      let p: Puzzle;
      while (true) {
        p = generatePuzzle();
        if (hasSolution(p.cards, p.goal)) break;
      }
      if (solveAbortRef.current !== puzzleId) return;
      const b = makeBoardFromPuzzle(p);
      setPuzzle(p);
      setBoard(b);
      setCurrentSolutions([]);
      setSolutionsReady(false);
      setPendingSolved(null);
      setPendingSkip(false);
      setHistoryStack([]);
      setStepStack([]);
      setSelectedTile(null);
      setSelectedOp(null);
      setGenerating(false);
      setTimerRunning(true);

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
      preGenerateNextPuzzle();
    }, 0);
  }, [preGenerateNextPuzzle]);

  useEffect(() => {
    if (screen === "home" || screen === "summary") {
      preGenerateNextPuzzle();
    }
  }, [screen, preGenerateNextPuzzle]);

  const startSession = useCallback(
    (m: Mode) => {
      setMode(m);
      setScreen("play");
      setSolvedCount(0);
      setSkippedCount(0);
      setSolved([]);
      setSkipped([]);
      sessionIndexRef.current = 1;
      setPlayElapsedMs(0);
      setSprintRemainingMs(SPRINT_DURATION_MS);
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

  useEffect(() => {
    if (mode === "sprint" && sprintRemainingMs <= 0 && screen === "play") {
      handleQuit();
    }
  }, [sprintRemainingMs, screen, mode, handleQuit]);

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
      setSkipped((prev) => [...prev, { puzzle: puzzle!, solutions: currentSolutions, sessionIndex: idx }]);
      setPendingSkip(false);
    }
  }, [solutionsReady, pendingSolved, pendingSkip, currentSolutions, puzzle]);

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
    startNewPuzzle();
  };

  const handleSkip = useCallback(() => {
    if (!puzzle || !board) return;
    const now = Date.now();
    if (now - skipDebounceRef.current < 800) return;
    skipDebounceRef.current = now;
    setSkippedCount((c) => c + 1);
    if (mode === "sprint") {
      setSprintRemainingMs((prev) => Math.max(0, prev - 20000));
    }
    setTimerRunning(false);
    setStepStack([]);
    if (solutionsReady) {
      const idx = sessionIndexRef.current++;
      setSkipped((prev) => [...prev, { puzzle, solutions: currentSolutions, sessionIndex: idx }]);
    } else {
      setPendingSkip(true);
    }
    setScreen("review");
  }, [puzzle, board, mode, solutionsReady, currentSolutions]);

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
        <p className="text-neutral-500 text-sm text-center max-w-sm mb-2">
          <strong>Target:</strong> Random number from 1–200.
        </p>
        <p className="text-neutral-500 text-sm text-center max-w-sm mb-2">
          <strong>Cards:</strong> Numbered 1–13.
        </p>
        <p className="text-neutral-500 text-sm text-center max-w-sm mb-4">
          <strong>Number of cards:</strong> 4 if &lt; 67, 5 if &lt; 67 × 2, 6 otherwise.
        </p>
        <label className="flex items-center gap-2 text-sm text-neutral-600 mb-6">
          <input
            type="checkbox"
            checked={useFaceCards}
            onChange={(e) => setUseFaceCards(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300 text-neutral-900"
          />
          <span>Show 11–13 as J/Q/K</span>
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
        </div>
      </div>
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
      <ReviewPanel
        goal={puzzle.goal}
        cards={puzzle.cards}
        useFaceCards={useFaceCards}
        steps={stepStack}
        solutions={currentSolutions}
        solutionsReady={solutionsReady}
        onContinue={handleContinue}
        onQuit={handleQuit}
      />
    );
  }

  // PLAY
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
            <div className="flex justify-center gap-3 px-4 pb-2 flex-wrap">
              <button
                onClick={handleUndo}
                disabled={historyStack.length === 0}
                className="min-h-[2.75rem] px-5 text-sm rounded-lg border border-neutral-200 text-neutral-500 active:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Undo
              </button>
              <button
                onClick={handleReset}
                className="min-h-[2.75rem] px-5 text-sm rounded-lg border border-neutral-200 text-neutral-500 active:bg-neutral-100 transition-colors"
              >
                Reset
              </button>
              <button
                onClick={handleSkip}
                className="min-h-[2.75rem] px-5 text-sm rounded-lg border border-neutral-300 text-neutral-600 active:bg-neutral-100 transition-colors"
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
