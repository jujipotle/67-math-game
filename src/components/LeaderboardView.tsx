"use client";

import { useCallback, useEffect, useState } from "react";
import LeaderboardTable, { LeaderboardEntry } from "@/components/LeaderboardTable";
import { buildApiUrl } from "@/lib/api";
import { isDev, type DataTarget } from "@/lib/dataSource";

type LeaderboardViewProps = {
  onBack: () => void;
  target: DataTarget;
  initialEntries?: LeaderboardEntry[];
};

export default function LeaderboardView({ onBack, target, initialEntries }: LeaderboardViewProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>(initialEntries ?? []);
  const [loading, setLoading] = useState(!initialEntries?.length);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (which: DataTarget) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(buildApiUrl("/api/leaderboard", which), { cache: "no-store" });
      const data = (await res.json()) as { entries?: LeaderboardEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load leaderboard");
      setEntries(data.entries ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load leaderboard");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(target);
  }, [load, target]);

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
        <div className="text-neutral-500 text-sm mb-1">5-Minute Sprint</div>
        {isDev && (
          <div className="text-xs text-neutral-400 mb-4">
            Viewing <span className="font-semibold">{target === "production" ? "Actual" : "Local"}</span> data
          </div>
        )}

        <button
          onClick={onBack}
          className="w-full h-12 mb-4 border-2 border-neutral-300 text-neutral-600 rounded-xl font-medium active:bg-neutral-100 transition-colors"
        >
          Back
        </button>

        <LeaderboardTable entries={entries} loading={loading} error={error} />
      </div>
    </div>
  );
}
