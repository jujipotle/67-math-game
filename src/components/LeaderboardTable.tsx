"use client";

import { useMemo, useState } from "react";

export type LeaderboardEntry = {
  id: number;
  name: string;
  score: number;
  createdAt: number;
};

export type LeaderboardTier = {
  score: number;
  entries: LeaderboardEntry[];
};

/** Group entries by score tier (ties share a row). Sorted by score desc. */
export function groupLeaderboardByScore(entries: LeaderboardEntry[]): LeaderboardTier[] {
  const sorted = [...entries].sort(
    (a, b) => b.score - a.score || a.createdAt - b.createdAt
  );
  const tiers: LeaderboardTier[] = [];
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

type LeaderboardTableProps = {
  entries: LeaderboardEntry[];
  loading?: boolean;
  error?: string | null;
  /** If set, shows "Your score: X (would be #Y)" above the table. */
  highlightScore?: number;
};

export default function LeaderboardTable({
  entries,
  loading = false,
  error = null,
  highlightScore,
}: LeaderboardTableProps) {
  const [showAll, setShowAll] = useState(false);

  const tiers = useMemo(() => groupLeaderboardByScore(entries), [entries]);
  const visibleTiers = showAll ? tiers : tiers.slice(0, 3);

  const userRank =
    highlightScore != null && highlightScore > 0 && tiers.length > 0
      ? 1 + tiers.filter((t) => t.score > highlightScore).length
      : null;

  if (loading) {
    return <div className="text-sm text-neutral-400">Loading leaderboard…</div>;
  }

  if (error) {
    return <div className="text-sm text-red-500">{error}</div>;
  }

  if (tiers.length === 0) {
    return <div className="text-sm text-neutral-400 italic">No entries yet.</div>;
  }

  return (
    <div className="w-full">
      {highlightScore != null && highlightScore > 0 && (
        <div className="text-sm text-neutral-600 mb-3">
          Your score: <span className="font-semibold">{highlightScore}</span>
          {userRank != null && (
            <>
              {" "}
              (would be <span className="font-semibold">#{userRank}</span>)
            </>
          )}
        </div>
      )}

      <div className="border border-neutral-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 text-neutral-500 text-left">
              <th className="py-2.5 px-4 font-medium w-20">Score</th>
              <th className="py-2.5 px-4 font-medium">Players</th>
            </tr>
          </thead>
          <tbody>
            {visibleTiers.map((tier, i) => (
              <tr
                key={`${tier.score}-${i}`}
                className="border-t border-neutral-100 even:bg-neutral-50/50"
              >
                <td className="py-2.5 px-4 font-semibold text-neutral-900 tabular-nums align-top">
                  {tier.score}
                </td>
                <td className="py-2.5 px-4 text-neutral-700">
                  {tier.entries.map((e) => e.name).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tiers.length > 3 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 w-full h-10 text-sm font-medium text-neutral-600 border border-neutral-200 rounded-xl active:bg-neutral-50 transition-colors"
        >
          {showAll ? "Show top 3" : `Show all (${entries.length})`}
        </button>
      )}
    </div>
  );
}
