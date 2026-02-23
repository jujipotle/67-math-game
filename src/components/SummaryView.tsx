"use client";

import { useState } from "react";
import { SolvedRecord, SkippedRecord } from "@/lib/types";

type SummaryViewProps = {
  mode: string;
  solved: SolvedRecord[];
  skipped: SkippedRecord[];
  solvedCount: number;
  skippedCount: number;
  totalTimeMs: number;
  onHome: () => void;
};

function stripOuterParens(s: string): string {
  if (s.startsWith("(") && s.endsWith(")")) return s.slice(1, -1);
  return s;
}

export default function SummaryView({ mode, solved, skipped, solvedCount, skippedCount, totalTimeMs, onHome }: SummaryViewProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [expandedSkipped, setExpandedSkipped] = useState<number | null>(null);

  const mins = Math.floor(totalTimeMs / 60000);
  const secs = Math.floor((totalTimeMs % 60000) / 1000);
  const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-y-auto"
      style={{
        paddingTop: "max(2rem, env(safe-area-inset-top, 2rem))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))",
      }}
    >
      <div className="flex flex-col items-center px-5 max-w-md mx-auto w-full flex-1">
        <div className="text-3xl font-bold mb-1">Session Complete</div>
        <div className="text-neutral-500 text-sm mb-1">
          {mode === "sprint" ? "5-Minute Sprint" : "Practice"}
        </div>
        <div className="text-neutral-400 text-sm mb-4">
          {timeStr} elapsed · {solvedCount} solved{skippedCount > 0 ? ` · ${skippedCount} skipped` : ""}
        </div>
        <button
          onClick={onHome}
          className="w-full max-w-xs h-12 mb-6 border-2 border-neutral-300 text-neutral-600 rounded-xl font-medium active:bg-neutral-100 transition-colors shrink-0"
        >
          Back to Home
        </button>

        {solved.length === 0 && skipped.length === 0 ? (
          <div className="text-neutral-400 text-sm italic mb-8">No puzzles solved or skipped.</div>
        ) : (
          <div className="w-full space-y-6 mb-8">
            {/* Solved */}
            {solved.length > 0 && (
              <>
                <div className="text-xs uppercase tracking-widest text-neutral-400">
                  Solved ({solved.length})
                </div>
                <div className="space-y-3">
                  {solved.map((record, i) => (
                    <div key={i} className="border border-neutral-200 rounded-xl overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between px-4 min-h-[3rem] active:bg-neutral-50 transition-colors text-left"
                        onClick={() => setExpanded(expanded === i ? null : i)}
                      >
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-semibold">#{record.sessionIndex ?? i + 1}</span>
                          <span className="text-neutral-500 text-sm">
                            Target: {record.puzzle.goal}
                          </span>
                          <span className="text-neutral-400 text-xs">
                            [{record.puzzle.cards.join(", ")}]
                          </span>
                        </div>
                        <span className="text-xs text-neutral-400 ml-2 shrink-0">
                          {expanded === i ? "▲" : "▼"}
                        </span>
                      </button>
                      {expanded === i && (
                        <div className="px-4 pb-3 border-t border-neutral-100 space-y-3">
                          <div>
                            <div className="text-xs uppercase tracking-widest text-neutral-400 mt-3 mb-1">
                              Your solution
                            </div>
                            <div className="text-sm font-mono bg-neutral-50 rounded-lg px-2 py-1.5 break-all">
                              {stripOuterParens(record.userFinalExpr)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-widest text-neutral-400 mb-1">
                              All solutions ({record.solutions.length})
                            </div>
                            <div className="max-h-40 overflow-y-auto space-y-1">
                              {record.solutions.map((sol, j) => (
                                <div key={j} className="text-[11px] font-mono bg-neutral-50 rounded-lg px-2 py-1 break-all">
                                  {sol}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Skipped */}
            {skipped.length > 0 && (
              <>
                <div className="text-xs uppercase tracking-widest text-neutral-400">
                  Skipped ({skipped.length})
                </div>
                <div className="space-y-3">
                  {skipped.map((record, i) => (
                    <div key={i} className="border border-neutral-200 rounded-xl overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between px-4 min-h-[3rem] active:bg-neutral-50 transition-colors text-left"
                        onClick={() => setExpandedSkipped(expandedSkipped === i ? null : i)}
                      >
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-semibold">#{record.sessionIndex ?? i + 1}</span>
                          <span className="text-neutral-500 text-sm">
                            Target: {record.puzzle.goal}
                          </span>
                          <span className="text-neutral-400 text-xs">
                            [{record.puzzle.cards.join(", ")}]
                          </span>
                        </div>
                        <span className="text-xs text-neutral-400 ml-2 shrink-0">
                          {expandedSkipped === i ? "▲" : "▼"}
                        </span>
                      </button>
                      {expandedSkipped === i && (
                        <div className="px-4 pb-3 border-t border-neutral-100">
                          <div className="text-xs uppercase tracking-widest text-neutral-400 mt-3 mb-1">
                            All solutions ({record.solutions.length})
                          </div>
                          <div className="max-h-40 overflow-y-auto space-y-1">
                            {record.solutions.map((sol, j) => (
                              <div key={j} className="text-[11px] font-mono bg-neutral-50 rounded-lg px-2 py-1 break-all">
                                {sol}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
