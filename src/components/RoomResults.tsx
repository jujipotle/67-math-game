"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LeaderboardTable, { type LeaderboardEntry } from "@/components/LeaderboardTable";
import PuzzleReviewList, { type PuzzleReviewItem } from "@/components/PuzzleReviewList";
import type { RoomStateView } from "@/lib/types";
import { solve } from "@/lib/solver";
import RoundLengthField from "@/components/RoundLengthField";

type RoomResultsProps = {
  room: RoomStateView;
  onStart: () => void;
  onSetDuration: (durationMs: number) => void;
  onLeave: (newHostId?: string) => void;
  onKick: (targetId: string) => void;
  starting?: boolean;
  notice?: string | null;
  actionError?: string | null;
};

export default function RoomResults({
  room,
  onStart,
  onSetDuration,
  onLeave,
  onKick,
  starting,
  notice,
  actionError,
}: RoomResultsProps) {
  const [pickingHost, setPickingHost] = useState(false);
  const [solutionsByIdx, setSolutionsByIdx] = useState<Record<number, string[]>>({});
  const isHost = room.you.isHost;
  const others = room.players.filter((p) => p.id && p.id !== room.you.playerId);
  const puzzleKey = room.puzzles.map((p) => `${p.idx}:${p.goal}:${p.cards.join(",")}`).join("|");

  const handleLeave = useCallback(() => {
    if (pickingHost) return;
    if (isHost && others.length > 0) {
      setPickingHost(true);
      return;
    }
    onLeave();
  }, [pickingHost, isHost, others.length, onLeave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      if (e.key !== "Escape" || !pickingHost) return;
      e.preventDefault();
      setPickingHost(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickingHost]);

  useEffect(() => {
    setSolutionsByIdx({});
    const puzzles = room.puzzles;
    if (puzzles.length === 0) return;

    let cancelled = false;
    const remaining = puzzles.map((p) => p.idx);
    const byIdx = new Map(puzzles.map((p) => [p.idx, p]));

    const applySolutions = (idx: number, solutions: string[]) => {
      if (cancelled) return;
      setSolutionsByIdx((prev) => ({ ...prev, [idx]: solutions }));
    };

    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("../workers/puzzle.worker.ts", import.meta.url));
    } catch {
      worker = null;
    }

    const runNext = () => {
      const idx = remaining.shift();
      if (idx == null) return;
      const puzzle = byIdx.get(idx);
      if (!puzzle) {
        runNext();
        return;
      }
      if (worker) {
        worker.postMessage({
          type: "solveAll",
          id: idx,
          cards: puzzle.cards,
          goal: puzzle.goal,
        });
        return;
      }
      setTimeout(() => {
        applySolutions(idx, solve(puzzle.cards, puzzle.goal));
        runNext();
      }, 0);
    };

    if (worker) {
      worker.onmessage = (
        e: MessageEvent<{ kind: string; id: number; solutions: string[] }>
      ) => {
        const msg = e.data;
        if (msg.kind !== "solutions") {
          runNext();
          return;
        }
        applySolutions(msg.id, msg.solutions);
        runNext();
      };
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
        runNext();
      };
    }
    runNext();

    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, [puzzleKey, room.puzzles]);

  const reviewItems: PuzzleReviewItem[] = useMemo(
    () =>
      room.puzzles.map((p) => ({
        sessionIndex: p.idx,
        puzzle: { goal: p.goal, cards: p.cards, n: p.cards.length },
        userFinalExpr: p.yourExpr ?? null,
        solutions: solutionsByIdx[p.idx] ?? [],
      })),
    [room.puzzles, solutionsByIdx]
  );

  const entries: LeaderboardEntry[] = room.players
    .filter((p) => p.participated)
    .map((p, i) => ({
      id: i + 1,
      name: p.name,
      score: p.score,
      createdAt: p.scoreReachedAt ?? Number.MAX_SAFE_INTEGER,
    }));

  return (
    <div
      className="fixed inset-0 overflow-y-auto"
      style={{
        paddingTop: "max(2rem, env(safe-area-inset-top, 2rem))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))",
      }}
    >
      <div className="flex flex-col items-center px-5 max-w-md mx-auto w-full">
        <h1 className="text-2xl font-bold mb-4">Room: {room.name}</h1>
        {notice ? (
          <div className="w-full mb-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
            {notice}
          </div>
        ) : null}
        {actionError ? (
          <div className="w-full mb-3 text-sm text-red-600">{actionError}</div>
        ) : null}

        <LeaderboardTable
          entries={entries}
          highlightScore={room.you.participated ? room.you.score : undefined}
          highlightName={room.you.name}
          rankPhrase="placed"
          footnote="Tied scores are ordered by who reached that score first."
        />

        {reviewItems.length > 0 && (
          <div className="w-full mt-5">
            <PuzzleReviewList title="Puzzles" items={reviewItems} />
          </div>
        )}

        <div className="w-full rounded-xl border border-neutral-200 mt-5 mb-4 overflow-hidden">
          <div className="px-3 py-2 text-xs uppercase tracking-widest text-neutral-400 bg-neutral-50">
            Players ({room.players.length})
          </div>
          <ul>
            {room.players.map((p, i) => (
              <li
                key={`${p.name}-${i}-${p.id || "x"}`}
                className="flex items-center justify-between px-3 py-2.5 border-t border-neutral-100"
              >
                <span>
                  {p.name}
                  {p.isHost ? (
                    <span className="ml-2 text-xs text-neutral-400">host</span>
                  ) : null}
                  {p.id === room.you.playerId ? (
                    <span className="ml-2 text-xs text-neutral-400">you</span>
                  ) : null}
                  {!p.participated ? (
                    <span className="ml-2 text-xs text-neutral-400">didn&apos;t play</span>
                  ) : null}
                </span>
                {isHost && p.id && p.id !== room.you.playerId && (
                  <button
                    type="button"
                    onClick={() => onKick(p.id)}
                    className="text-xs text-red-600 font-medium"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        <RoundLengthField
          durationMs={room.roundDurationMs}
          editable={isHost}
          onCommit={onSetDuration}
          className="w-full mb-3"
        />

        <button
          type="button"
          disabled={!isHost || starting}
          onClick={onStart}
          className="w-full h-14 mb-3 rounded-xl bg-neutral-900 text-white font-medium text-lg disabled:bg-neutral-200 disabled:text-neutral-500 disabled:cursor-not-allowed"
        >
          {isHost
            ? starting
              ? "Starting…"
              : "Start next round"
            : "Waiting for host to start"}
        </button>

        <button
          type="button"
          onClick={handleLeave}
          className="w-full h-12 rounded-xl border-2 border-neutral-300 text-neutral-600 font-medium"
        >
          Leave room
        </button>
      </div>

      {pickingHost && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-20"
          onClick={() => setPickingHost(false)}
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
              {others.map((p) => (
                <button
                  key={p.id || p.name}
                  type="button"
                  onClick={() => onLeave(p.id)}
                  className="w-full h-11 rounded-xl border border-neutral-300 text-sm font-medium"
                >
                  {p.name}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPickingHost(false)}
              className="w-full h-11 rounded-xl border border-neutral-200 text-sm text-neutral-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
