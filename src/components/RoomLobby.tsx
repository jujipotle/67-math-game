"use client";

import { useCallback, useEffect, useState } from "react";
import type { RoomStateView } from "@/lib/types";
import ConfirmSheet from "@/components/ConfirmSheet";
import RoundLengthField from "@/components/RoundLengthField";

type RoomLobbyProps = {
  room: RoomStateView;
  onStart: () => void;
  onSetDuration: (durationMs: number) => void;
  onLeave: (newHostId?: string) => void;
  onKick: (targetId: string) => void;
  starting?: boolean;
  notice?: string | null;
  actionError?: string | null;
};

function shareUrl(name: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/?room=${encodeURIComponent(name)}`;
}

export default function RoomLobby({
  room,
  onStart,
  onSetDuration,
  onLeave,
  onKick,
  starting,
  notice,
  actionError,
}: RoomLobbyProps) {
  const [copied, setCopied] = useState(false);
  const [pickingHost, setPickingHost] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const isHost = room.you.isHost;
  const others = room.players.filter((p) => p.id && p.id !== room.you.playerId);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(room.name));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const confirmLeave = useCallback(() => {
    setLeaveConfirm(false);
    if (isHost && others.length > 0) {
      setPickingHost(true);
      return;
    }
    onLeave();
  }, [isHost, others.length, onLeave]);

  const requestLeave = () => {
    if (pickingHost) return;
    if (leaveConfirm) {
      confirmLeave();
      return;
    }
    setLeaveConfirm(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (pickingHost) {
        setPickingHost(false);
        return;
      }
      if (leaveConfirm) {
        confirmLeave();
        return;
      }
      setLeaveConfirm(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickingHost, leaveConfirm, confirmLeave]);

  return (
    <div
      className="fixed inset-0 overflow-y-auto"
      style={{
        paddingTop: "max(2rem, env(safe-area-inset-top, 2rem))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))",
      }}
    >
      <div className="flex flex-col items-center px-5 max-w-md mx-auto w-full">
        <h1 className="text-2xl font-bold mb-1 text-center">{room.name}</h1>
        <p className="text-neutral-500 text-sm mb-4">hosted by {room.hostName}</p>
        {notice ? (
          <div className="w-full mb-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
            {notice}
          </div>
        ) : null}
        {actionError ? (
          <div className="w-full mb-3 text-sm text-red-600">{actionError}</div>
        ) : null}

        <button
          type="button"
          onClick={copyLink}
          className="w-full h-11 mb-4 rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700 active:bg-neutral-50"
        >
          {copied ? "Link copied" : "Copy invite link"}
        </button>

        <div className="w-full rounded-xl border border-neutral-200 mb-4 overflow-hidden">
          <div className="px-3 py-2 text-xs uppercase tracking-widest text-neutral-400 bg-neutral-50">
            Players ({room.players.length})
          </div>
          <ul>
            {room.players.map((p, i) => (
              <li
                key={`${p.name}-${i}-${p.id || "x"}`}
                className="flex items-center justify-between px-3 py-2.5 border-t border-neutral-100"
              >
                <span>
                  {p.name}
                  {p.isHost ? (
                    <span className="ml-2 text-xs text-neutral-400">host</span>
                  ) : null}
                  {p.id === room.you.playerId ? (
                    <span className="ml-2 text-xs text-neutral-400">you</span>
                  ) : null}
                </span>
                {isHost && p.id && p.id !== room.you.playerId && (
                  <button
                    type="button"
                    onClick={() => onKick(p.id)}
                    className="text-xs text-red-600 font-medium"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        <RoundLengthField
          durationMs={room.roundDurationMs}
          editable={isHost}
          onCommit={onSetDuration}
        />

        <button
          type="button"
          disabled={!isHost || starting}
          onClick={onStart}
          className="w-full h-14 mb-3 rounded-xl bg-neutral-900 text-white font-medium text-lg disabled:bg-neutral-200 disabled:text-neutral-500 disabled:cursor-not-allowed"
        >
          {isHost ? (starting ? "Starting…" : "Start round") : "Waiting for host to start"}
        </button>

        <button
          type="button"
          onClick={requestLeave}
          className="w-full h-12 rounded-xl border-2 border-neutral-300 text-neutral-600 font-medium"
        >
          Leave room
        </button>
      </div>

      {leaveConfirm && (
        <ConfirmSheet
          title="Leave?"
          body="You'll leave this room."
          confirmLabel="Leave"
          onConfirm={confirmLeave}
          onCancel={() => setLeaveConfirm(false)}
        />
      )}

      {pickingHost && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-20"
          onClick={() => setPickingHost(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-semibold mb-1">Choose a new host</div>
            <p className="text-sm text-neutral-500 mb-3">
              Pick who should host after you leave.
            </p>
            <div className="flex flex-col gap-2 mb-3">
              {others.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onLeave(p.id)}
                  className="w-full h-11 rounded-xl border border-neutral-300 text-sm font-medium"
                >
                  {p.name}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPickingHost(false)}
              className="w-full h-11 rounded-xl border border-neutral-200 text-sm text-neutral-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
