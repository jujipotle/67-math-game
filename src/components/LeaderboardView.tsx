"use client";

import { useEffect, useState } from "react";

type Entry = {
  id: number;
  name: string;
  score: number;
  createdAt: number;
};

/** Group entries by score (order of submission = createdAt). Tiers sorted by score desc. */
function groupByScore(entries: Entry[]): { score: number; entries: Entry[] }[] {
  const sorted = [...entries].sort(
    (a, b) => b.score - a.score || a.createdAt - b.createdAt
  );
  const tiers: { score: number; entries: Entry[] }[] = [];
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

type LeaderboardViewProps = {
  onBack: () => void;
  initialEntries?: Entry[];
};

export default function LeaderboardView({ onBack, initialEntries }: LeaderboardViewProps) {
  const [entries, setEntries] = useState<Entry[]>(initialEntries ?? []);
  const [loading, setLoading] = useState(!initialEntries?.length);
  const [error, setError] = useState<string | null>(null);
  const [expandedRank, setExpandedRank] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!initialEntries?.length) setLoading(true);
        setError(null);
        const res = await fetch("/api/leaderboard", { cache: "no-store" });
        const data = (await res.json()) as { entries?: Entry[]; error?: string };
        if (!res.ok) throw new Error(data.error || "Failed to load leaderboard");
        if (!cancelled) setEntries(data.entries ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load leaderboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialEntries?.length]);

  const tiers = groupByScore(entries);

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-y-auto"
      style={{
        paddingTop: "max(2rem, env(safe-area-inset-top, 2rem))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))",
      }}
    >
      <div className="flex flex-col items-center px-5 max-w-md mx-auto w-full flex-1 min-h-0">
        <div className="text-3xl font-bold mb-1">Leaderboard</div>
        <div className="text-neutral-500 text-sm mb-4">5-Minute Sprint</div>

        <button
          onClick={onBack}
          className="w-full max-w-xs h-12 mb-6 border-2 border-neutral-300 text-neutral-600 rounded-xl font-medium active:bg-neutral-100 transition-colors"
        >
          Back
        </button>

        {loading ? (
          <div className="text-neutral-400 text-sm">Loading…</div>
        ) : error ? (
          <div className="text-red-500 text-sm">{error}</div>
        ) : tiers.length === 0 ? (
          <div className="text-neutral-400 text-sm italic">No entries yet.</div>
        ) : (
          <div className="w-full space-y-2">
            {tiers.map((tier, i) => {
              const rank = i + 1;
              const showNamesByDefault = rank <= 3;
              const isExpanded = showNamesByDefault || expandedRank === rank;

              return (
                <div
                  key={tier.score * 10000 + i}
                  className="border border-neutral-200 rounded-xl overflow-hidden"
                >
                  {showNamesByDefault ? (
                    <div className="px-4 py-3">
                      <div className="text-sm font-semibold text-neutral-700">
                        #{rank} — Score {tier.score}
                      </div>
                      <div className="text-sm text-neutral-600 mt-0.5">
                        {tier.entries.map((e) => e.name).join(", ")}
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setExpandedRank(expandedRank === rank ? null : rank)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left active:bg-neutral-50 transition-colors"
                      >
                        <span className="text-sm font-semibold text-neutral-700">
                          #{rank} — Score {tier.score} ({tier.entries.length}{" "}
                          {tier.entries.length === 1 ? "person" : "people"})
                        </span>
                        <span className="text-xs text-neutral-400">
                          {isExpanded ? "▲" : "▼"}
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-3 pt-0 border-t border-neutral-100">
                          <div className="text-sm text-neutral-600 mt-2">
                            {tier.entries.map((e) => e.name).join(", ")}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
