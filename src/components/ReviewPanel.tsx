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
  steps: Step[];
  solutions: string[];
  onContinue: () => void;
  onQuit: () => void;
};

export default function ReviewPanel({
  goal,
  cards,
  steps,
  solutions,
  onContinue,
  onQuit,
}: ReviewPanelProps) {
  const [showSolutions, setShowSolutions] = useState(true);
  const skipped = steps.length === 0;

  const oneLineExpr =
    !skipped && steps.length > 0
      ? (() => {
          const s = steps[steps.length - 1].resultExpr;
          if (s.startsWith("(") && s.endsWith(")")) return s.slice(1, -1);
          return s;
        })()
      : "";

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-y-auto"
      style={{
        paddingTop: "max(1.5rem, env(safe-area-inset-top, 1.5rem))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))",
      }}
    >
      <div className="flex flex-col items-center px-5 max-w-md mx-auto w-full flex-1 min-h-0">
        <div className="text-3xl font-bold mb-1">{skipped ? "Skipped" : "Solved!"}</div>
        <div className="text-neutral-500 text-sm mb-6">
          Target: {goal} · Cards: {cards.join(", ")}
        </div>

        <div className="w-full mb-6">
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

        <div className="w-full mb-8 flex-1 min-h-0 flex flex-col">
          <button
            onClick={() => setShowSolutions(!showSolutions)}
            className="text-xs uppercase tracking-widest text-neutral-400 active:text-neutral-600 transition-colors mb-2 flex items-center gap-1 min-h-[2.75rem] shrink-0"
          >
            All solutions ({solutions.length})
            <span className="text-[10px]">{showSolutions ? "▲" : "▼"}</span>
          </button>
          {showSolutions && (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1">
              {solutions.length === 0 ? (
                <div className="text-sm text-neutral-400 italic">None found</div>
              ) : (
                solutions.map((sol, i) => (
                  <div key={i} className="text-xs font-mono bg-neutral-50 rounded-lg px-3 py-1.5 break-all">
                    {sol}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="mt-auto w-full flex flex-col sm:flex-row gap-3 justify-center items-center pb-2">
          <button
            onClick={onQuit}
            className="w-full max-w-xs h-12 border-2 border-neutral-300 text-neutral-600 rounded-xl font-medium active:bg-neutral-100 transition-colors"
          >
            Quit
          </button>
          <button
            onClick={onContinue}
            className="w-full max-w-xs h-14 bg-neutral-900 text-white rounded-xl font-medium text-lg active:bg-neutral-700 transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
