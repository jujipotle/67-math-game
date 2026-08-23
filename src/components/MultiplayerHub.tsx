"use client";

import { useCallback, useEffect, useState } from "react";
import { buildApiUrl } from "@/lib/api";
import { isDev, type DataTarget } from "@/lib/dataSource";
import type { RoomListItem, RoomStateView } from "@/lib/types";

type MultiplayerHubProps = {
  target: DataTarget;
  initialRoomName?: string | null;
  onEntered: (room: RoomStateView) => void;
  onBack: () => void;
};

export default function MultiplayerHub({
  target,
  initialRoomName,
  onEntered,
  onBack,
}: MultiplayerHubProps) {
  const [playerName, setPlayerName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState("");
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [joinTarget, setJoinTarget] = useState<RoomListItem | null>(null);
  const [joinPassword, setJoinPassword] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [invitePassword, setInvitePassword] = useState("");
  const [nameTakenRoom, setNameTakenRoom] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(buildApiUrl("/api/rooms", target), { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        rooms?: RoomListItem[];
        error?: string;
      };
      if (!res.ok) {
        if (isDev && target === "production" && (res.status === 404 || res.status === 502)) {
          throw new Error(
            "Couldn’t reach live multiplayer. Switch Data source to Local on the home screen, or try again."
          );
        }
        throw new Error(data.error || "Failed to load rooms");
      }
      setListError(null);
      setRooms(data.rooms ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Failed to load rooms");
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, [target]);

  useEffect(() => {
    load();
    const i = setInterval(load, 2000);
    return () => clearInterval(i);
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(buildApiUrl("/api/rooms", target), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName,
          roomName: roomName.trim() || undefined,
          isPrivate,
          password: isPrivate ? password : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { room?: RoomStateView; error?: string };
      if (!res.ok || !data.room) {
        if (isDev && target === "production" && (res.status === 404 || res.status === 502)) {
          throw new Error(
            "Couldn’t reach live multiplayer. Switch Data source to Local on the home screen, or try again."
          );
        }
        throw new Error(data.error || "Could not create room");
      }
      onEntered(data.room);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create room");
    } finally {
      setBusy(false);
    }
  };

  const isNameTakenMessage = (msg: string) =>
    /already in this room/i.test(msg);

  const showNameTaken = (room: string) => {
    setNameTakenRoom(room);
    setError(null);
    setJoinError(null);
  };

  const join = async (room: RoomListItem, pw?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(buildApiUrl("/api/rooms/join", target), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: room.id,
          playerName,
          password: pw,
        }),
      });
      const data = (await res.json()) as { room?: RoomStateView; error?: string };
      if (!res.ok || !data.room) throw new Error(data.error || "Could not join");
      setJoinTarget(null);
      setJoinPassword("");
      setJoinError(null);
      onEntered(data.room);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not join";
      if (isNameTakenMessage(msg)) {
        showNameTaken(room.name);
        setJoinTarget(null);
        return;
      }
      if (joinTarget) setJoinError(msg);
      else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const joinByName = async (name: string, pw?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(buildApiUrl("/api/rooms/join", target), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName: name,
          playerName,
          password: pw,
        }),
      });
      const data = (await res.json()) as { room?: RoomStateView; error?: string };
      if (!res.ok || !data.room) throw new Error(data.error || "Could not join");
      onEntered(data.room);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not join";
      if (isNameTakenMessage(msg)) showNameTaken(name);
      else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const nameTakenIn = (room: RoomListItem, name: string) =>
    room.playerNames.some((n) => n.toLowerCase() === name.trim().toLowerCase());

  const listedInvite = initialRoomName
    ? rooms.find((r) => r.name.toLowerCase() === initialRoomName.toLowerCase())
    : undefined;
  const inviteKnownPublic = listedInvite?.isPrivate === false;
  const inviteMissing =
    !!initialRoomName && hasLoadedOnce && !listError && !listedInvite;
  const showInvitePassword = !!initialRoomName && !inviteKnownPublic && !inviteMissing;
  const requireInvitePassword = listedInvite?.isPrivate === true;

  const statusLabel = (s: RoomListItem["status"]) =>
    s === "playing" ? "In round" : s === "results" ? "Results" : "Lobby";

  const joinInvite = () => {
    if (!initialRoomName) return;
    if (listedInvite && nameTakenIn(listedInvite, playerName)) {
      showNameTaken(listedInvite.name);
      return;
    }
    if (listedInvite) {
      join(listedInvite, showInvitePassword ? invitePassword : undefined);
      return;
    }
    joinByName(initialRoomName, showInvitePassword ? invitePassword : undefined);
  };

  /** Only relevant in local `npm run dev` when Data source is Actual. */
  const productionWarning = isDev && target === "production" && (
    <div className="w-full mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      Data source is <span className="font-semibold">Actual</span> — rooms load
      from the live site. For offline testing, switch to{" "}
      <span className="font-semibold">Local</span> on the home screen.
    </div>
  );

  return (
    <div
      className="fixed inset-0 overflow-y-auto"
      style={{
        paddingTop: "max(2rem, env(safe-area-inset-top, 2rem))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))",
      }}
    >
      <div className="flex flex-col items-center px-5 max-w-md mx-auto w-full">
        {initialRoomName ? (
          <>
            <h1 className="text-3xl font-bold mb-1 text-center">{initialRoomName}</h1>
            {inviteMissing ? (
              <p className="text-neutral-500 text-sm mb-6 text-center">
                This room wasn’t found. It may have ended or the name is wrong.
              </p>
            ) : listedInvite ? (
              <div className="text-center mb-6">
                <p className="text-neutral-600 text-sm">
                  hosted by {listedInvite.hostName}
                </p>
                <p className="text-neutral-500 text-sm mt-0.5">
                  {statusLabel(listedInvite.status)}
                  {listedInvite.isPrivate ? " · Private" : ""}
                  {" · "}
                  {listedInvite.playerCount} player
                  {listedInvite.playerCount === 1 ? "" : "s"}
                </p>
              </div>
            ) : (
              <div className="text-center mb-6">
                <p className="text-neutral-400 text-sm">hosted by …</p>
                <p className="text-neutral-400 text-sm mt-0.5">Loading…</p>
              </div>
            )}

            {productionWarning}

            {(listError || error) && (
              <div className="w-full mb-3 text-sm text-red-600">{listError || error}</div>
            )}

            {!inviteMissing && (
              <>
                <label className="w-full text-sm font-medium text-neutral-600 mb-1">
                  Your name
                </label>
                <input
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  maxLength={20}
                  placeholder="Required to join"
                  className="w-full h-12 px-3 mb-3 rounded-xl border border-neutral-300 text-base"
                />
                {showInvitePassword && (
                  <input
                    type="password"
                    value={invitePassword}
                    onChange={(e) => setInvitePassword(e.target.value)}
                    maxLength={40}
                    placeholder={requireInvitePassword ? "Password" : "Password (if private)"}
                    className="w-full h-12 px-3 mb-3 rounded-xl border border-neutral-300 text-base"
                  />
                )}
                <button
                  type="button"
                  disabled={
                    busy ||
                    !playerName.trim() ||
                    (requireInvitePassword && !invitePassword.trim())
                  }
                  onClick={joinInvite}
                  className="w-full h-12 mb-3 rounded-xl bg-neutral-900 text-white font-medium disabled:opacity-40"
                >
                  Join
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onBack}
              className="w-full h-12 border-2 border-neutral-300 text-neutral-600 rounded-xl font-medium active:bg-neutral-100 transition-colors"
            >
              Back
            </button>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold mb-1">Multiplayer</h1>
            <p className="text-neutral-500 text-sm mb-4 text-center">
              Same puzzles, shared timer. See who solves more.
            </p>

            <button
              onClick={onBack}
              className="w-full h-12 mb-4 border-2 border-neutral-300 text-neutral-600 rounded-xl font-medium active:bg-neutral-100 transition-colors"
            >
              Back
            </button>

            <label className="w-full text-sm font-medium text-neutral-600 mb-1">Your name</label>
            <input
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              maxLength={20}
              placeholder="Required to create or join"
              className="w-full h-12 px-3 mb-4 rounded-xl border border-neutral-300 text-base"
            />

            {productionWarning}

            {(listError || error) && (
              <div className="w-full mb-3 text-sm text-red-600">{listError || error}</div>
            )}

            <div className="w-full rounded-xl border border-neutral-200 p-4 mb-4">
              <div className="font-semibold mb-3">Create a room</div>
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                maxLength={20}
                placeholder="Name (optional)"
                className="w-full h-11 px-3 mb-3 rounded-xl border border-neutral-300 text-sm"
              />
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setIsPrivate(false)}
                  className={`flex-1 h-10 rounded-xl text-sm font-medium border ${
                    !isPrivate
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "border-neutral-300 text-neutral-600"
                  }`}
                >
                  Public
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrivate(true)}
                  className={`flex-1 h-10 rounded-xl text-sm font-medium border ${
                    isPrivate
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "border-neutral-300 text-neutral-600"
                  }`}
                >
                  Private
                </button>
              </div>
              {isPrivate && (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={40}
                  placeholder="Password"
                  className="w-full h-11 px-3 mb-3 rounded-xl border border-neutral-300 text-sm"
                />
              )}
              <button
                type="button"
                disabled={busy || !playerName.trim() || (isPrivate && !password.trim())}
                onClick={create}
                className="w-full h-12 rounded-xl bg-neutral-900 text-white font-medium disabled:opacity-40"
              >
                Create
              </button>
            </div>

            <div className="w-full">
              <div className="font-semibold mb-2">Rooms</div>
              {loading && rooms.length === 0 ? (
                <div className="text-sm text-neutral-400">Loading…</div>
              ) : rooms.length === 0 ? (
                <div className="text-sm text-neutral-400 italic">No rooms yet.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {rooms.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      disabled={busy || !playerName.trim()}
                      onClick={() => {
                        if (nameTakenIn(r, playerName)) {
                          showNameTaken(r.name);
                          return;
                        }
                        if (r.isPrivate) {
                          setJoinTarget(r);
                          setJoinPassword("");
                          setJoinError(null);
                          setError(null);
                          return;
                        }
                        join(r);
                      }}
                      className="w-full text-left rounded-xl border border-neutral-200 px-3 py-3 active:bg-neutral-50 disabled:opacity-40"
                    >
                      <div className="font-medium">
                        {r.name} – hosted by {r.hostName}
                      </div>
                      <div className="text-xs text-neutral-500 mt-0.5">
                        {statusLabel(r.status)}
                        {r.isPrivate ? " · Private" : ""}
                        {" · "}
                        {r.playerCount} player{r.playerCount === 1 ? "" : "s"}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {joinTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-20">
          <div className="bg-white rounded-2xl w-full max-w-sm p-4">
            <div className="font-semibold mb-1">Join {joinTarget.name}</div>
            <p className="text-sm text-neutral-500 mb-3">This room is private. Enter the password.</p>
            <input
              type="password"
              value={joinPassword}
              onChange={(e) => {
                setJoinPassword(e.target.value);
                if (joinError) setJoinError(null);
              }}
              maxLength={40}
              placeholder="Password"
              className="w-full h-11 px-3 mb-3 rounded-xl border border-neutral-300 text-sm"
            />
            {joinError && (
              <div className="text-sm text-red-600 mb-3">{joinError}</div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setJoinTarget(null);
                  setJoinPassword("");
                  setJoinError(null);
                }}
                className="flex-1 h-11 rounded-xl border border-neutral-300 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !joinPassword.trim() || !playerName.trim()}
                onClick={() => join(joinTarget, joinPassword)}
                className="flex-1 h-11 rounded-xl bg-neutral-900 text-white text-sm font-medium disabled:opacity-40"
              >
                Join
              </button>
            </div>
          </div>
        </div>
      )}
      {nameTakenRoom && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-20"
          onClick={() => setNameTakenRoom(null)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-semibold mb-1">Name already in use</div>
            <p className="text-sm text-neutral-500 mb-4">
              Someone in {nameTakenRoom} already has your username. Pick a new one.
            </p>
            <button
              type="button"
              onClick={() => setNameTakenRoom(null)}
              className="w-full h-12 rounded-xl bg-neutral-900 text-white font-medium"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
