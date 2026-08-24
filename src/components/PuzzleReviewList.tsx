"use client";

import { useState } from "react";
import type { Puzzle } from "@/lib/types";

export type PuzzleReviewItem = {
  sessionIndex: number;
  puzzle: Puzzle;
  userFinalExpr: string | null;
  solutions: string[];
};

type PuzzleReviewListProps = {
  title: string;
  items: PuzzleReviewItem[];
  useFaceCards?: boolean;
  hideUnsolvedNote?: boolean;
};

function stripOuterParens(s: string): string {
  if (s.startsWith("(") && s.endsWith(")")) return s.slice(1, -1);
  return s;
}

function formatCard(n: number, useFaceCards: boolean): string {
  if (!useFaceCards) return n.toString();
  if (n === 1) return "A";
  if (n === 11) return "J";
  if (n === 12) return "Q";
  if (n === 13) return "K";
  return n.toString();
}

export default function PuzzleReviewList({
  title,
  items,
  useFaceCards = false,
  hideUnsolvedNote = false,
}: PuzzleReviewListProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const visible = items.filter((r) => r.puzzle != null);

  if (visible.length === 0) return null;

  return (
    <div className="w-full space-y-3">
      <div className="text-xs uppercase tracking-widest text-neutral-400">
        {title} ({visible.length})
      </div>
      {visible.map((record, i) => (
        <div key={record.sessionIndex} className="border border-neutral-200 rounded-xl overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 min-h-[3rem] active:bg-neutral-50 transition-colors text-left"
            onClick={() => setExpanded(expanded === i ? null : i)}
          >
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-semibold">#{record.sessionIndex}</span>
              <span className="text-neutral-500 text-sm">Target: {record.puzzle.goal}</span>
              <span className="text-neutral-400 text-xs">
                [{record.puzzle.cards.map((c) => formatCard(c, useFaceCards)).join(", ")}]
              </span>
            </div>
            <span className="text-xs text-neutral-400 ml-2 shrink-0">
              {expanded === i ? "▲" : "▼"}
            </span>
          </button>
          {expanded === i && (
            <div className="px-4 pb-3 border-t border-neutral-100 space-y-3">
              {record.userFinalExpr ? (
                <div>
                  <div className="text-xs uppercase tracking-widest text-neutral-400 mt-3 mb-1">
                    Your solution
                  </div>
                  <div className="text-sm font-mono bg-neutral-50 rounded-lg px-2 py-1.5 break-all">
                    {stripOuterParens(record.userFinalExpr)}
                  </div>
                </div>
              ) : hideUnsolvedNote ? (
                <div className="mt-3" />
              ) : (
                <div className="text-sm text-neutral-400 italic mt-3">You didn&apos;t solve this one.</div>
              )}
              <div>
                <div className="text-xs uppercase tracking-widest text-neutral-400 mb-1">
                  {record.solutions.length > 0
                    ? `All solutions (${record.solutions.length})`
                    : "All solutions"}
                </div>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {record.solutions.length > 0 ? (
                    record.solutions.map((sol, j) => (
                      <div
                        key={j}
                        className="text-[11px] font-mono bg-neutral-50 rounded-lg px-2 py-1 break-all"
                      >
                        {sol}
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-neutral-400 italic">Generating all solutions…</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
