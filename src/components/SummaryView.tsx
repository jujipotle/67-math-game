"use client";

import { useEffect, useState } from "react";
import { SolvedRecord, SkippedRecord } from "@/lib/types";

type SummaryViewProps = {
  mode: string;
  solved: SolvedRecord[];
  skipped: SkippedRecord[];
  useFaceCards: boolean;
  leaderboardSessionId: string | null;
  solvedCount: number;
  skippedCount: number;
  totalTimeMs: number;
  onHome: () => void;
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

type LbEntry = { id: number; name: string; score: number; createdAt: number };

function groupLbByScore(entries: LbEntry[]): { score: number; entries: LbEntry[] }[] {
  const sorted = [...entries].sort(
    (a, b) => b.score - a.score || a.createdAt - b.createdAt
  );
  const tiers: { score: number; entries: LbEntry[] }[] = [];
  for (const e of sorted) {
    const last = tiers[tiers.length - 1];
    if (last && last.score === e.score) {
      last.entries.push(e);
    } else {
      tiers.push({ score: e.score, entries: [e] });
    }
  }
  return tiers;
}

export default function SummaryView({
  mode,
  solved,
  skipped,
  useFaceCards,
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
  const [lbEntries, setLbEntries] = useState<LbEntry[] | null>(null);
  const [lbError, setLbError] = useState<string | null>(null);
  const [lbLoading, setLbLoading] = useState(false);
  const [expandedLbRank, setExpandedLbRank] = useState<number | null>(null);

  const mins = Math.floor(totalTimeMs / 60000);
  const secs = Math.floor((totalTimeMs % 60000) / 1000);
  const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

  useEffect(() => {
    if (mode !== "sprint" || !leaderboardSessionId) return;
    let cancelled = false;
    (async () => {
      try {
        setLbLoading(true);
        setLbError(null);
        const res = await fetch("/api/leaderboard", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
          entries?: LbEntry[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Failed to load leaderboard");
        if (!cancelled) setLbEntries(data.entries ?? []);
      } catch (e) {
        if (!cancelled) setLbError(e instanceof Error ? e.message : "Failed to load leaderboard");
      } finally {
        if (!cancelled) setLbLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, leaderboardSessionId]);

  const userScore = mode === "sprint" ? solvedCount : 0;

  const lbTiers = lbEntries && lbEntries.length > 0 ? groupLbByScore(lbEntries) : [];
  const userRank =
    userScore > 0 && lbTiers.length > 0
      ? 1 + lbTiers.filter((t) => t.score > userScore).length
      : null;

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-y-auto"
      style={{
        paddingTop: "max(2rem, env(safe-area-inset-top, 2rem))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))",
      }}
    >
      <div className="flex flex-col items-center px-5 max-w-md mx-auto w-full flex-1 min-h-0">
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
          <div className="w-full max-w-xs mb-6">
            <div className="text-xs uppercase tracking-widest text-neutral-400 mb-2">
              Leaderboard
            </div>
            {submitOk ? (
              <div className="text-sm text-neutral-600 mb-2">
                Submitted. Score: <span className="font-semibold">{submitOk.score}</span>
              </div>
            ) : (
              <>
                <div className="flex gap-2 mb-1">
                  <input
                    value={leaderName}
                    onChange={(e) => setLeaderName(e.target.value)}
                    placeholder="Your name"
                    className="flex-1 h-12 px-3 rounded-xl border border-neutral-200 text-neutral-800 bg-white"
                    maxLength={20}
                  />
                  <button
                    disabled={submitting}
                    onClick={async () => {
                      setSubmitError(null);
                      setSubmitting(true);
                      try {
                        const res = await fetch("/api/leaderboard", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ sessionId: leaderboardSessionId, name: leaderName }),
                        });
                        const data = (await res.json()) as { ok?: boolean; score?: number; error?: string };
                        if (!res.ok || !data.ok || typeof data.score !== "number") {
                          throw new Error(data.error || "Failed to submit");
                        }
                        setSubmitOk({ score: data.score });
                      } catch (e) {
                        setSubmitError(e instanceof Error ? e.message : "Failed to submit");
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    className="h-12 px-4 rounded-xl bg-neutral-900 text-white font-medium active:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Submit
                  </button>
                </div>
                {submitError && (
                  <div className="text-xs text-red-500 mt-1">{submitError}</div>
                )}
                <div className="text-[11px] text-neutral-400 mb-2">
                  1–20 chars. Letters, numbers, spaces, _ and -.
                </div>
              </>
            )}

            {/* Current leaderboard + where you stand */}
            <div className="mt-2 border-t border-neutral-200 pt-2">
              {lbLoading ? (
                <div className="text-xs text-neutral-400">Loading leaderboard…</div>
              ) : lbError ? (
                <div className="text-xs text-red-500">{lbError}</div>
              ) : lbTiers.length > 0 ? (
                <>
                  {userScore > 0 && (
                    <div className="text-xs text-neutral-600 mb-1">
                      Your score:{" "}
                      <span className="font-semibold">{userScore}</span>
                      {userRank != null && (
                        <>
                          {" "}
                          (would be <span className="font-semibold">#{userRank}</span> on this board)
                        </>
                      )}
                    </div>
                  )}
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {lbTiers.map((tier, i) => {
                      const rank = i + 1;
                      const showNames = rank <= 3;
                      const isExpanded = showNames || expandedLbRank === rank;
                      return (
                        <div key={tier.score * 10000 + i} className="rounded-lg bg-neutral-50 overflow-hidden">
                          {showNames ? (
                            <div className="px-3 py-1.5">
                              <span className="text-xs text-neutral-700 font-medium">
                                #{rank} — {tier.score}:
                              </span>{" "}
                              <span className="text-xs text-neutral-600">
                                {tier.entries.map((e) => e.name).join(", ")}
                              </span>
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setExpandedLbRank(expandedLbRank === rank ? null : rank)}
                                className="w-full flex items-center justify-between px-3 py-1.5 text-left active:bg-neutral-100"
                              >
                                <span className="text-xs text-neutral-700 font-medium">
                                  #{rank} — {tier.score} ({tier.entries.length}{" "}
                                  {tier.entries.length === 1 ? "person" : "people"})
                                </span>
                                <span className="text-[10px] text-neutral-400">
                                  {isExpanded ? "▲" : "▼"}
                                </span>
                              </button>
                              {isExpanded && (
                                <div className="px-3 pb-1.5 text-xs text-neutral-600">
                                  {tier.entries.map((e) => e.name).join(", ")}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="text-xs text-neutral-400">No entries yet.</div>
              )}
            </div>
          </div>
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
