"use client";

import { useCallback, useEffect, useState } from "react";
import { SolvedRecord, SkippedRecord } from "@/lib/types";
import LeaderboardTable, { LeaderboardEntry } from "@/components/LeaderboardTable";
import ConfirmSheet from "@/components/ConfirmSheet";
import { buildApiUrl } from "@/lib/api";
import type { DataTarget } from "@/lib/dataSource";

type SummaryViewProps = {
  mode: string;
  solved: SolvedRecord[];
  skipped: SkippedRecord[];
  useFaceCards: boolean;
  target: DataTarget;
  leaderboardSessionId: string | null;
  solvedCount: number;
  skippedCount: number;
  totalTimeMs: number;
  onHome: () => void;
};

type NameConflict =
  | { kind: "replaceable"; existingScore: number; score: number; lowerCount: number }
  | { kind: "add"; existingScore: number; score: number };

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


export default function SummaryView({
  mode,
  solved,
  skipped,
  useFaceCards,
  target,
  leaderboardSessionId,
  solvedCount,
  skippedCount,
  totalTimeMs,
  onHome,
}: SummaryViewProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [expandedSkipped, setExpandedSkipped] = useState<number | null>(null);
  const [leaderName, setLeaderName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState<{ score: number } | null>(null);
  const [lbEntries, setLbEntries] = useState<LeaderboardEntry[]>([]);
  const [lbError, setLbError] = useState<string | null>(null);
  const [lbLoading, setLbLoading] = useState(false);
  const [nameConflict, setNameConflict] = useState<NameConflict | null>(null);

  const mins = Math.floor(totalTimeMs / 60000);
  const secs = Math.floor((totalTimeMs % 60000) / 1000);
  const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

  const userScore = mode === "sprint" ? solvedCount : 0;

  const loadLeaderboard = useCallback(async () => {
    try {
      setLbLoading(true);
      setLbError(null);
      const res = await fetch(buildApiUrl("/api/leaderboard", target), { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        entries?: LeaderboardEntry[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Failed to load leaderboard");
      setLbEntries(data.entries ?? []);
    } catch (e) {
      setLbError(e instanceof Error ? e.message : "Failed to load leaderboard");
    } finally {
      setLbLoading(false);
    }
  }, [target]);

  useEffect(() => {
    if (mode !== "sprint" || !leaderboardSessionId) return;
    loadLeaderboard();
  }, [mode, leaderboardSessionId, loadLeaderboard]);

  const submitScore = useCallback(
    async (opts?: { replace?: boolean; confirmAdd?: boolean }) => {
      if (!leaderboardSessionId) return;
      setSubmitError(null);
      setSubmitting(true);
      try {
        const res = await fetch(buildApiUrl("/api/leaderboard", target), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: leaderboardSessionId,
            name: leaderName,
            replace: opts?.replace === true,
            confirmAdd: opts?.confirmAdd === true,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          score?: number;
          error?: string;
          conflict?: "replaceable" | "add";
          existingScore?: number;
          lowerCount?: number;
        };
        if (
          res.status === 409 &&
          data.conflict === "replaceable" &&
          typeof data.existingScore === "number"
        ) {
          setNameConflict({
            kind: "replaceable",
            existingScore: data.existingScore,
            score: typeof data.score === "number" ? data.score : userScore,
            lowerCount: typeof data.lowerCount === "number" ? data.lowerCount : 1,
          });
          return;
        }
        if (
          res.status === 409 &&
          data.conflict === "add" &&
          typeof data.existingScore === "number"
        ) {
          setNameConflict({
            kind: "add",
            existingScore: data.existingScore,
            score: typeof data.score === "number" ? data.score : userScore,
          });
          return;
        }
        if (!res.ok || !data.ok || typeof data.score !== "number") {
          throw new Error(data.error || "Failed to submit");
        }
        setNameConflict(null);
        setSubmitOk({ score: data.score });
        await loadLeaderboard();
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : "Failed to submit");
      } finally {
        setSubmitting(false);
      }
    },
    [leaderboardSessionId, leaderName, loadLeaderboard, target, userScore]
  );

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-y-auto"
      style={{
        paddingTop: "max(2rem, env(safe-area-inset-top, 2rem))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))",
      }}
    >
      <div className="flex flex-col items-center px-5 pb-8 max-w-md mx-auto w-full flex-1 min-h-0">
        <div className="text-3xl font-bold mb-1">Session Complete</div>
        <div className="text-neutral-500 text-sm mb-1">
          {mode === "sprint" ? "5-Minute Sprint" : "Practice"}
        </div>
        <div className="text-neutral-400 text-sm mb-2">
          {timeStr} elapsed · {solvedCount} solved{skippedCount > 0 ? ` · ${skippedCount} skipped` : ""}
        </div>
        <button
          onClick={onHome}
          className="w-full max-w-xs h-12 mb-4 border-2 border-neutral-300 text-neutral-600 rounded-xl font-medium active:bg-neutral-100 transition-colors shrink-0"
        >
          Back to Home
        </button>

        {mode === "sprint" && leaderboardSessionId && (
          <div className="w-full max-w-md mb-6">
            <div className="text-xs uppercase tracking-widest text-neutral-400 mb-2">
              Leaderboard
            </div>
            {submitOk ? (
              <div className="text-sm text-neutral-600 mb-3">
                Submitted. Score: <span className="font-semibold">{submitOk.score}</span>
              </div>
            ) : (
              <>
                <div className="flex gap-2 mb-1">
                  <input
                    value={leaderName}
                    onChange={(e) => {
                      setLeaderName(e.target.value);
                      setNameConflict(null);
                      setSubmitError(null);
                    }}
                    placeholder="Your name"
                    className="flex-1 h-12 px-3 rounded-xl border border-neutral-200 text-neutral-800 bg-white"
                    maxLength={20}
                  />
                  <button
                    disabled={submitting || !leaderName.trim()}
                    onClick={() => void submitScore()}
                    className="h-12 px-4 rounded-xl bg-neutral-900 text-white font-medium active:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Submit
                  </button>
                </div>
                {submitError && (
                  <div className="text-xs text-red-500 mt-1">{submitError}</div>
                )}
                <div className="text-[11px] text-neutral-400 mb-4">
                  1–20 chars. Letters, numbers, spaces, _ and -.
                </div>
              </>
            )}

            <LeaderboardTable
              entries={lbEntries}
              loading={lbLoading}
              error={lbError}
              highlightScore={submitOk ? submitOk.score : userScore}
              footnote="Tied scores are ordered by who submitted that score first."
            />
          </div>
        )}

        {nameConflict?.kind === "replaceable" && (
          <ConfirmSheet
            title="New personal best"
            body={
              nameConflict.lowerCount > 1
                ? `“${leaderName.trim()}” already has ${nameConflict.lowerCount} entries (best: ${nameConflict.existingScore}). Replace them all with your new score of ${nameConflict.score}?`
                : `“${leaderName.trim()}” is already on the board at ${nameConflict.existingScore}. Replace it with your new score of ${nameConflict.score}?`
            }
            confirmLabel="Replace all"
            cancelLabel="Cancel"
            onConfirm={() => void submitScore({ replace: true })}
            onCancel={() => setNameConflict(null)}
          />
        )}
        {nameConflict?.kind === "add" && (
          <ConfirmSheet
            title="Add this score?"
            body={`“${leaderName.trim()}” already has ${nameConflict.existingScore} on the board. Your score is ${nameConflict.score}. Add it as a separate entry? Your existing score won’t be changed.`}
            confirmLabel="Add entry"
            showConfirmShortcut={false}
            cancelLabel="Cancel"
            onConfirm={() => void submitScore({ confirmAdd: true })}
            onCancel={() => setNameConflict(null)}
          />
        )}

        {solved.length === 0 && skipped.length === 0 ? (
          <div className="text-neutral-400 text-sm italic mb-8">No puzzles solved or skipped.</div>
        ) : (
          <div className="w-full space-y-6 mb-4">
            {/* Solved */}
            {solved.length > 0 && (
              <>
                <div className="text-xs uppercase tracking-widest text-neutral-400">
                  Solved ({solved.length})
                </div>
                <div className="space-y-3">
                  {solved.filter((r) => r.puzzle != null).map((record, i) => (
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
                            [
                            {record.puzzle.cards
                              .map((c) => formatCard(c, useFaceCards))
                              .join(", ")}
                            ]
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
                              {record.solutions && record.solutions.length > 0
                                ? `All solutions (${record.solutions.length})`
                                : "All solutions"}
                            </div>
                            <div className="max-h-64 overflow-y-auto space-y-1">
                              {record.solutions && record.solutions.length > 0 ? (
                                record.solutions.map((sol, j) => (
                                  <div key={j} className="text-[11px] font-mono bg-neutral-50 rounded-lg px-2 py-1 break-all">
                                    {sol}
                                  </div>
                                ))
                              ) : (
                                <div className="text-sm text-neutral-400 italic">
                                  Generating all solutions…
                                </div>
                              )}
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
                  {skipped.filter((r) => r.puzzle != null).map((record, i) => (
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
                            [
                            {record.puzzle.cards
                              .map((c) => formatCard(c, useFaceCards))
                              .join(", ")}
                            ]
                          </span>
                        </div>
                        <span className="text-xs text-neutral-400 ml-2 shrink-0">
                          {expandedSkipped === i ? "▲" : "▼"}
                        </span>
                      </button>
                      {expandedSkipped === i && (
                        <div className="px-4 pb-3 border-t border-neutral-100">
                          <div className="text-xs uppercase tracking-widest text-neutral-400 mt-3 mb-1">
                            {record.solutions && record.solutions.length > 0
                              ? `All solutions (${record.solutions.length})`
                              : "All solutions"}
                          </div>
                          <div className="max-h-64 overflow-y-auto space-y-1">
                            {record.solutions && record.solutions.length > 0 ? (
                              record.solutions.map((sol, j) => (
                                <div key={j} className="text-[11px] font-mono bg-neutral-50 rounded-lg px-2 py-1 break-all">
                                  {sol}
                                </div>
                              ))
                            ) : (
                              <div className="text-sm text-neutral-400 italic">
                                Generating all solutions…
                              </div>
                            )}
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
