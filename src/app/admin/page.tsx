"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { buildApiUrl } from "@/lib/api";
import { isDev, useDataSource } from "@/lib/dataSource";

type Entry = {
  id: number;
  name: string;
  score: number;
  createdAt: number;
};

export default function AdminPage() {
  const { target } = useDataSource();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editScore, setEditScore] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(buildApiUrl("/api/leaderboard", target), {
        cache: "no-store",
      });
      const data = (await res.json()) as { entries?: Entry[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load");
      const sorted = [...(data.entries ?? [])].sort(
        (a, b) => b.score - a.score || a.createdAt - b.createdAt
      );
      setEntries(sorted);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    load();
  }, [load]);

  const beginEdit = (e: Entry) => {
    setEditingId(e.id);
    setEditName(e.name);
    setEditScore(String(e.score));
    setStatus(null);
    setError(null);
  };

  const saveEdit = async (id: number) => {
    setBusyId(id);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(buildApiUrl("/api/leaderboard", target), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: editName,
          score: Number(editScore),
          kind: "new",
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Edit failed");
      setStatus(`Saved #${id}`);
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Edit failed");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: number, name: string) => {
    if (
      !window.confirm(
        `Delete "${name}" (id ${id}) from the ${target} leaderboard? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyId(id);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(buildApiUrl("/api/leaderboard", target), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Delete failed");
      setStatus(`Deleted #${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  if (!isDev) {
    return (
      <div className="fixed inset-0 flex items-center justify-center p-8 text-center">
        <div className="text-neutral-500">
          Admin tools are only available in local development.
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-y-auto bg-white text-neutral-900 p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-1">Leaderboard Admin</h1>
        <p className="text-sm text-neutral-500 mb-4">
          Local dev tool. Admin key is read from <code>.env</code> on the server.
        </p>

        <Link
          href="/"
          className="inline-flex items-center h-9 px-4 mb-4 rounded-lg border border-neutral-300 text-sm font-medium text-neutral-700 active:bg-neutral-100"
        >
          ← Back to Home
        </Link>

        <div className="flex items-center gap-3 mb-4">
          <div className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm">
            <span className="text-neutral-500">Data source:</span>
            <span className="font-semibold">
              {target === "production" ? "Actual" : "Local"}
            </span>
          </div>
          <button
            type="button"
            onClick={load}
            className="h-9 px-4 rounded-lg border border-neutral-300 text-sm font-medium text-neutral-700 active:bg-neutral-100"
          >
            Refresh
          </button>
        </div>
        <p className="text-xs text-neutral-400 mb-4">
          Switch between Local and Actual with the toggle on the home screen.
        </p>

        {target === "production" && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            You are editing the <strong>live production</strong> leaderboard.
            Changes affect the real site immediately.
          </div>
        )}

        {status && (
          <div className="mb-3 text-sm text-green-700">{status}</div>
        )}
        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

        {loading ? (
          <div className="text-sm text-neutral-400">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="text-sm text-neutral-400 italic">No entries.</div>
        ) : (
          <div className="border border-neutral-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-neutral-500 text-left">
                  <th className="py-2.5 px-3 font-medium w-14">Score</th>
                  <th className="py-2.5 px-3 font-medium">Player</th>
                  <th className="py-2.5 px-3 font-medium w-40 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const editing = editingId === e.id;
                  const busy = busyId === e.id;
                  return (
                    <tr key={e.id} className="border-t border-neutral-100">
                      <td className="py-2 px-3 align-middle tabular-nums font-semibold">
                        {editing ? (
                          <input
                            value={editScore}
                            onChange={(ev) => setEditScore(ev.target.value)}
                            inputMode="numeric"
                            className="w-14 h-8 px-2 rounded border border-neutral-300"
                          />
                        ) : (
                          e.score
                        )}
                      </td>
                      <td className="py-2 px-3 align-middle">
                        {editing ? (
                          <input
                            value={editName}
                            onChange={(ev) => setEditName(ev.target.value)}
                            maxLength={20}
                            className="w-full h-8 px-2 rounded border border-neutral-300"
                          />
                        ) : (
                          <span>
                            {e.name}{" "}
                            <span className="text-neutral-400 text-xs">#{e.id}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 align-middle text-right whitespace-nowrap">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => saveEdit(e.id)}
                              className="h-8 px-3 rounded-lg bg-neutral-900 text-white text-xs font-medium disabled:opacity-40"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="ml-2 h-8 px-3 rounded-lg border border-neutral-300 text-xs"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => beginEdit(e)}
                              className="h-8 px-3 rounded-lg border border-neutral-300 text-xs font-medium active:bg-neutral-100"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => remove(e.id, e.name)}
                              className="ml-2 h-8 px-3 rounded-lg border border-red-300 text-red-600 text-xs font-medium active:bg-red-50 disabled:opacity-40"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
