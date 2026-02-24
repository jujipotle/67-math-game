"use client";

import { useState } from "react";
import { Step } from "@/lib/types";

const OP_SYMBOLS: Record<string, string> = {
  "+": "+",
  "-": "−",
  "*": "×",
  "/": "÷",
};

type ReviewPanelProps = {
  goal: number;
  cards: number[];
  useFaceCards: boolean;
  steps: Step[];
  solutions: string[];
  solutionsReady: boolean;
  onContinue: () => void;
};

export default function ReviewPanel({
  goal,
  cards,
  useFaceCards,
  steps,
  solutions,
  solutionsReady,
  onContinue,
}: ReviewPanelProps) {
  const skipped = steps.length === 0;

  const oneLineExpr =
    !skipped && steps.length > 0
      ? (() => {
          const s = steps[steps.length - 1].resultExpr;
          if (s.startsWith("(") && s.endsWith(")")) return s.slice(1, -1);
          return s;
        })()
      : "";

  const formatCard = (n: number): string => {
    if (!useFaceCards) return n.toString();
    if (n === 1) return "A";
    if (n === 11) return "J";
    if (n === 12) return "Q";
    if (n === 13) return "K";
    return n.toString();
  };

  return (
    <div
      className="flex flex-col items-center px-5 max-w-md mx-auto w-full flex-1 min-h-0 overflow-y-auto"
      style={{
        paddingTop: "1.5rem",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))",
      }}
    >
      <div className="flex flex-col items-center w-full flex-1 min-h-0">
        <div className="text-3xl font-bold mb-1">{skipped ? "Skipped" : "Solved!"}</div>
        <div className="text-neutral-500 text-sm mb-6">
          Target: {goal} · Cards: {cards.map(formatCard).join(", ")}
        </div>

        <div className="w-full mb-4">
          {oneLineExpr && (
            <>
              <div className="text-xs uppercase tracking-widest text-neutral-400 mb-2">
                Your solution
              </div>
              <div className="text-sm font-mono bg-neutral-50 rounded-lg px-3 py-2 break-all">
                {oneLineExpr}
              </div>
            </>
          )}
        </div>

        <div className="w-full mb-4 flex flex-col gap-3 justify-center items-center">
          <button
            onClick={onContinue}
            className="w-full max-w-xs h-14 bg-neutral-900 text-white rounded-xl font-medium text-lg active:bg-neutral-700 transition-colors"
          >
            Continue
          </button>
        </div>

        <div className="w-full mb-2 flex-1 min-h-0 flex flex-col">
          <div className="text-xs uppercase tracking-widest text-neutral-400 mb-2">
            All solutions{solutionsReady && solutions.length > 0 ? ` (${solutions.length})` : ""}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1">
            {!solutionsReady ? (
              <div className="text-sm text-neutral-400 italic">Generating all solutions…</div>
            ) : solutions.length === 0 ? (
              <div className="text-sm text-neutral-400 italic">None found</div>
            ) : (
              solutions.map((sol, i) => (
                <div key={i} className="text-xs font-mono bg-neutral-50 rounded-lg px-3 py-1.5 break-all">
                  {sol}
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
