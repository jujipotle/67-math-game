"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { buildApiUrl } from "@/lib/api";
import { isDev, useDataSource } from "@/lib/dataSource";
import { groupLeaderboardByScore } from "@/components/LeaderboardTable";

type Entry = {
  id: number;
  name: string;
  score: number;
  createdAt: number;
};

type AdminRoom = {
  id: string;
  name: string;
  hostName: string;
  isPrivate: boolean;
  status: string;
  playerCount: number;
  createdAt: number;
  playerNames: string[];
};

export default function AdminPage() {
  const { target } = useDataSource();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editScore, setEditScore] = useState("");
  const [busyId, setBusyId] = useState<number | string | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

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
      setSelectedIds([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [target]);

  const loadRooms = useCallback(async () => {
    setRoomsLoading(true);
    try {
      const res = await fetch(buildApiUrl("/api/rooms/admin", target), {
        cache: "no-store",
      });
      const data = (await res.json()) as { rooms?: AdminRoom[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load rooms");
      setRooms(data.rooms ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rooms");
      setRooms([]);
    } finally {
      setRoomsLoading(false);
    }
  }, [target]);

  useEffect(() => {
    load();
    loadRooms();
  }, [load, loadRooms]);

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

  const removeRoom = async (id: string, name: string) => {
    if (!window.confirm(`Delete room "${name}"? Everyone will be kicked. This cannot be undone.`)) {
      return;
    }
    setBusyId(id);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(buildApiUrl(`/api/rooms/${id}`, target), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Delete failed");
      setStatus(`Deleted room ${name}`);
      await loadRooms();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleScoreGroup = (ids: number[]) => {
    setSelectedIds((prev) => {
      const allOn = ids.every((id) => prev.includes(id));
      if (allOn) return prev.filter((id) => !ids.includes(id));
      return [...new Set([...prev, ...ids])];
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) =>
      prev.length === entries.length ? [] : entries.map((e) => e.id)
    );
  };

  const removeSelected = async () => {
    if (selectedIds.length === 0) return;
    if (
      !window.confirm(
        `Delete ${selectedIds.length} leaderboard ${
          selectedIds.length === 1 ? "entry" : "entries"
        } from the ${target} leaderboard? This cannot be undone.`
      )
    ) {
      return;
    }
    setBulkBusy(true);
    setError(null);
    setStatus(null);
    // Live production only accepts { id }, matching the working per-row Delete.
    const ids = selectedIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
    try {
      let deleted = 0;
      let lastError: string | null = null;
      for (const id of ids) {
        const res = await fetch(buildApiUrl("/api/leaderboard", target), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          lastError = data.error || "Delete failed";
          continue;
        }
        deleted += 1;
      }
      if (deleted === 0) throw new Error(lastError || "Delete failed");
      setStatus(`Deleted ${deleted} ${deleted === 1 ? "entry" : "entries"}`);
      setSelectedIds([]);
      await load();
      if (lastError) setError(lastError);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      if (ids.length > 0) await load();
    } finally {
      setBulkBusy(false);
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
        <h1 className="text-2xl font-bold mb-1">Admin</h1>
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
            onClick={() => {
              load();
              loadRooms();
            }}
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
            You are editing the <strong>live production</strong> database.
            Changes affect the real site immediately.
          </div>
        )}

        {status && (
          <div className="mb-3 text-sm text-green-700">{status}</div>
        )}
        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

        <h2 className="text-lg font-semibold mb-2">Leaderboard</h2>

        {loading ? (
          <div className="text-sm text-neutral-400">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="text-sm text-neutral-400 italic">No entries.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <button
                type="button"
                onClick={toggleAll}
                className="h-9 px-3 rounded-lg border border-neutral-300 text-xs font-medium active:bg-neutral-100"
              >
                {selectedIds.length === entries.length ? "Clear all" : "Select all"}
              </button>
              <button
                type="button"
                disabled={bulkBusy || selectedIds.length === 0}
                onClick={removeSelected}
                className="h-9 px-3 rounded-lg border border-red-300 text-red-600 text-xs font-medium active:bg-red-50 disabled:opacity-40"
              >
                Delete selected ({selectedIds.length})
              </button>
              <span className="text-xs text-neutral-400">
                Check a score group to select everyone tied at that score.
              </span>
            </div>
            <div className="border border-neutral-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-50 text-neutral-500 text-left">
                    <th className="py-2.5 px-3 font-medium w-10"></th>
                    <th className="py-2.5 px-3 font-medium w-14">Score</th>
                    <th className="py-2.5 px-3 font-medium">Player</th>
                    <th className="py-2.5 px-3 font-medium w-40 text-right">Actions</th>
                  </tr>
                </thead>
                {groupLeaderboardByScore(entries).map((tier) => {
                  const groupIds = tier.entries.map((e) => e.id);
                  const groupOn = groupIds.every((id) => selectedIds.includes(id));
                  return (
                    <tbody key={tier.score}>
                      <tr className="border-t border-neutral-200 bg-neutral-50">
                        <td className="py-1.5 px-3">
                          <input
                            type="checkbox"
                            checked={groupOn}
                            onChange={() => toggleScoreGroup(groupIds)}
                            aria-label={`Select all with score ${tier.score}`}
                          />
                        </td>
                        <td
                          colSpan={3}
                          className="py-1.5 px-3 text-xs font-medium text-neutral-600"
                        >
                          Score {tier.score}
                          {" · "}
                          {tier.entries.length} player
                          {tier.entries.length === 1 ? "" : "s"}
                        </td>
                      </tr>
                      {tier.entries.map((e) => {
                        const editing = editingId === e.id;
                        const busy = busyId === e.id;
                        return (
                          <tr key={e.id} className="border-t border-neutral-100">
                            <td className="py-2 px-3 align-middle">
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(e.id)}
                                onChange={() => toggleSelected(e.id)}
                                aria-label={`Select ${e.name}`}
                              />
                            </td>
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
                  );
                })}
              </table>
            </div>
          </>
        )}

        <h2 className="text-lg font-semibold mt-8 mb-2">Rooms</h2>
        {roomsLoading ? (
          <div className="text-sm text-neutral-400">Loading rooms…</div>
        ) : rooms.length === 0 ? (
          <div className="text-sm text-neutral-400 italic">No live rooms.</div>
        ) : (
          <div className="border border-neutral-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-neutral-500 text-left">
                  <th className="py-2.5 px-3 font-medium">Room</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium w-28 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => {
                  const busy = busyId === r.id;
                  return (
                    <tr key={r.id} className="border-t border-neutral-100">
                      <td className="py-2 px-3 align-top">
                        <div className="font-medium">
                          {r.name} – hosted by {r.hostName}
                        </div>
                        <div className="text-xs text-neutral-400">
                          {r.isPrivate ? "Private" : "Public"}
                          {" · "}
                          {r.playerNames.length
                            ? r.playerNames.join(", ")
                            : "empty"}
                        </div>
                      </td>
                      <td className="py-2 px-3 align-top text-neutral-600">
                        {r.status}
                        <div className="text-xs text-neutral-400">
                          {r.playerCount} player{r.playerCount === 1 ? "" : "s"}
                        </div>
                      </td>
                      <td className="py-2 px-3 align-top text-right">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => removeRoom(r.id, r.name)}
                          className="h-8 px-3 rounded-lg border border-red-300 text-red-600 text-xs font-medium active:bg-red-50 disabled:opacity-40"
                        >
                          Delete
                        </button>
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
