import { generateSprintPuzzle } from "./generator";
import { hashRoomPassword, verifyRoomPassword } from "./password";
import {
  consumeRoomKick,
  deleteRoomCascade,
  deleteRoomPlayer,
  expireRoomKicks,
  formatRoomSyncCursor,
  getRoom,
  getRoomByName,
  getRoomMaxPuzzleIdx,
  getRoomPlayer,
  getRoomPuzzle,
  getRoomSyncState,
  insertRoom,
  insertRoomKick,
  insertRoomPlayer,
  listRoomNames,
  listRoomPlayers,
  listRoomPuzzles,
  listRoomSolvesForPlayer,
  listRooms,
  newId,
  resetRoomPlayersForRound,
  updateRoom,
  updateRoomPlayer,
  upsertRoomPuzzle,
  upsertRoomSolve,
  type RoomPlayerRow,
  type RoomRow,
} from "./roomDb";
import { sanitizeName } from "./sanitize";
import { containsBlockedTerm } from "./blocklist";
import { validateFinalExpr } from "./solver";
import type {
  RoomListItem,
  RoomPlayerView,
  RoomPuzzleView,
  RoomStateView,
} from "./types";

import {
  DEFAULT_ROUND_MS,
  isValidRoundDurationMs,
  minutesToRoundMs,
  roundMsToMinutes,
} from "./duration";
import {
  notifyRoomChange,
  ROOM_LONG_POLL_MS,
  ROOM_WAIT_SLICE_MS,
  waitForRoomNotify,
} from "./roomWait";
/** Hidden-tab timers are throttled; keep seats through brief locks / alt-tabs. */
export const STALE_MS = 180_000;
export const PREFETCH_COUNT = 10;
export const INITIAL_PUZZLES = 8;
export const MAX_PLAYERS = 100;

export type RoomError = {
  error: string;
  status: number;
  roomName?: string;
  kickedBy?: string;
};

function isErr(x: unknown): x is RoomError {
  return !!x && typeof x === "object" && "error" in x && "status" in x;
}

function err(error: string, status: number): RoomError {
  return { error, status };
}

function kickedErr(roomName: string, kickedBy: string): RoomError {
  return { error: "kicked", status: 403, roomName, kickedBy };
}

export function nextDefaultRoomName(existing: string[]): string {
  const used = new Set<number>();
  for (const name of existing) {
    const m = /^Room (\d+)$/.exec(name);
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `Room ${n}`;
}

export function computeLeader(
  players: RoomPlayerRow[]
): { playerId: string; name: string; score: number } | null {
  const contenders = players.filter((p) => p.participated && p.score > 0);
  if (contenders.length === 0) return null;
  const maxScore = Math.max(...contenders.map((p) => p.score));
  const tied = contenders.filter((p) => p.score === maxScore);
  const minT = Math.min(...tied.map((p) => p.scoreReachedAt ?? Number.MAX_SAFE_INTEGER));
  const firsts = tied.filter(
    (p) => (p.scoreReachedAt ?? Number.MAX_SAFE_INTEGER) === minT
  );
  firsts.sort((a, b) => a.id.localeCompare(b.id));
  const leader = firsts[0];
  if (!leader) return null;
  return { playerId: leader.id, name: leader.name, score: leader.score };
}

async function ensurePuzzles(roomId: string, round: number, upToIdx: number): Promise<void> {
  const max = await getRoomMaxPuzzleIdx(roomId, round);
  for (let idx = max + 1; idx <= upToIdx; idx++) {
    const band = ((idx - 1) % 3) as 0 | 1 | 2;
    const p = generateSprintPuzzle(band);
    await upsertRoomPuzzle({
      roomId,
      round,
      idx,
      goal: p.goal,
      cardsJson: JSON.stringify(p.cards),
    });
  }
}

async function maybeEndRound(room: RoomRow, now: number): Promise<RoomRow> {
  if (room.status === "playing" && room.roundEndsAt != null && now >= room.roundEndsAt) {
    await updateRoom(room.id, { status: "results", updatedAt: now });
    notifyRoomChange(room.id);
    return { ...room, status: "results", updatedAt: now };
  }
  return room;
}

function pickRandomHost(players: RoomPlayerRow[]): RoomPlayerRow | null {
  if (players.length === 0) return null;
  return players[Math.floor(Math.random() * players.length)] ?? null;
}

export async function removePlayerFromRoom(
  roomId: string,
  playerId: string,
  newHostId: string | undefined,
  now: number
): Promise<{ deleted: boolean }> {
  const room = await getRoom(roomId);
  if (!room) return { deleted: true };
  await deleteRoomPlayer(playerId);
  const remaining = await listRoomPlayers(roomId);
  if (remaining.length === 0) {
    await deleteRoomCascade(roomId);
    notifyRoomChange(roomId);
    return { deleted: true };
  }
  if (room.hostId === playerId) {
    const chosen =
      (newHostId ? remaining.find((p) => p.id === newHostId) : null) ??
      pickRandomHost(remaining);
    if (chosen) {
      await updateRoom(roomId, { hostId: chosen.id, updatedAt: now });
    }
  }
  notifyRoomChange(roomId);
  return { deleted: false };
}

export async function sweepRoom(roomId: string, now: number, keepId?: string): Promise<void> {
  const players = await listRoomPlayers(roomId);
  const stale = players.filter(
    (p) => p.id !== keepId && now - p.lastSeenAt > STALE_MS
  );
  for (const p of stale) {
    await removePlayerFromRoom(roomId, p.id, undefined, now);
  }
}

export async function sweepAllRooms(now: number): Promise<void> {
  const rooms = await listRooms();
  for (const room of rooms) {
    await sweepRoom(room.id, now);
  }
}

/** Hub listing should not evict a player from a live room. Only drop fully abandoned rooms. */
async function sweepAbandonedRooms(now: number): Promise<void> {
  await expireRoomKicks(now, 60 * 60 * 1000);
  const rooms = await listRooms();
  for (const room of rooms) {
    const players = await listRoomPlayers(room.id);
    if (players.length === 0 || players.every((p) => now - p.lastSeenAt > STALE_MS)) {
      await deleteRoomCascade(room.id);
    }
  }
}

function toListItem(room: RoomRow, players: RoomPlayerRow[]): RoomListItem {
  const host = players.find((p) => p.id === room.hostId);
  return {
    id: room.id,
    name: room.name,
    hostName: host?.name ?? "Unknown",
    isPrivate: room.isPrivate === 1,
    status: room.status,
    playerCount: players.length,
    playerNames: players.map((p) => p.name),
  };
}

export async function listRoomSummaries(): Promise<RoomListItem[]> {
  const now = Date.now();
  await sweepAbandonedRooms(now);
  const rooms = await listRooms();
  const items: RoomListItem[] = [];
  for (const room of rooms) {
    await maybeEndRound(room, now);
    const players = await listRoomPlayers(room.id);
    if (players.length === 0) continue;
    items.push(toListItem(room, players));
  }
  return items;
}

export async function listRoomSummariesAdmin(): Promise<
  (RoomListItem & { createdAt: number; status: RoomRow["status"]; playerNames: string[] })[]
> {
  const now = Date.now();
  await sweepAbandonedRooms(now);
  const rooms = await listRooms();
  const items: (RoomListItem & { createdAt: number; playerNames: string[] })[] = [];
  for (const room of rooms) {
    const live = await maybeEndRound(room, now);
    const players = await listRoomPlayers(live.id);
    items.push({
      ...toListItem(live, players),
      createdAt: live.createdAt,
      playerNames: players.map((p) => p.name),
    });
  }
  return items;
}

function checkPlayerName(raw: string): string | RoomError {
  const name = sanitizeName(raw);
  if (!name) return err("Invalid name.", 400);
  if (containsBlockedTerm(name)) return err("That name is not allowed.", 400);
  return name;
}

export async function createRoom(input: {
  playerName: string;
  roomName?: string;
  isPrivate: boolean;
  password?: string;
}): Promise<{ room: RoomStateView } | RoomError> {
  const playerName = checkPlayerName(input.playerName);
  if (isErr(playerName)) return playerName;

  if (input.isPrivate) {
    const pw = (input.password ?? "").trim();
    if (pw.length < 1 || pw.length > 40) return err("Invalid password.", 400);
  }

  const existing = await listRoomNames();
  let name: string;
  if (input.roomName && input.roomName.trim()) {
    const sanitized = sanitizeName(input.roomName);
    if (!sanitized) return err("Invalid room name.", 400);
    if (containsBlockedTerm(sanitized)) return err("That room name is not allowed.", 400);
    if (existing.some((n) => n.toLowerCase() === sanitized.toLowerCase())) {
      return err("That room name is taken.", 409);
    }
    name = sanitized;
  } else {
    name = nextDefaultRoomName(existing);
  }

  const now = Date.now();
  const playerId = newId();
  const roomId = newId();
  const room: RoomRow = {
    id: roomId,
    name,
    hostId: playerId,
    isPrivate: input.isPrivate ? 1 : 0,
    passwordHash: input.isPrivate ? hashRoomPassword((input.password ?? "").trim()) : null,
    status: "lobby",
    round: 0,
    roundStartedAt: null,
    roundEndsAt: null,
    roundDurationMs: DEFAULT_ROUND_MS,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await insertRoom(room);
  } catch {
    return err("That room name is taken.", 409);
  }
  await insertRoomPlayer({
    id: playerId,
    roomId,
    name: playerName,
    joinedAt: now,
    lastSeenAt: now,
    role: "active",
    score: 0,
    scoreReachedAt: null,
    puzzleIdx: 0,
    participated: 0,
  });
  const snapshot = await getRoomSnapshot(roomId, playerId);
  if (!snapshot || isErr(snapshot)) return err("Could not create the room.", 500);
  return { room: snapshot };
}

export async function joinRoom(input: {
  roomId?: string;
  roomName?: string;
  playerName: string;
  password?: string;
}): Promise<{ room: RoomStateView } | RoomError> {
  const playerName = checkPlayerName(input.playerName);
  if (isErr(playerName)) return playerName;

  const now = Date.now();
  let room = input.roomId
    ? await getRoom(input.roomId)
    : input.roomName
      ? await getRoomByName(input.roomName)
      : null;
  if (!room) return err("Room not found.", 404);
  await sweepRoom(room.id, now);
  room = await getRoom(room.id);
  if (!room) return err("Room not found.", 404);
  room = await maybeEndRound(room, now);

  const players = await listRoomPlayers(room.id);
  if (players.length >= MAX_PLAYERS) return err("This room is full.", 409);
  if (players.some((p) => p.name.toLowerCase() === playerName.toLowerCase())) {
    return err("That name is already in this room.", 409);
  }

  if (room.isPrivate === 1) {
    const pw = (input.password ?? "").trim();
    if (!pw || !room.passwordHash || !verifyRoomPassword(pw, room.passwordHash)) {
      return err("Incorrect password.", 403);
    }
  }

  const role = room.status === "playing" ? "waiting" : "active";
  const playerId = newId();
  await insertRoomPlayer({
    id: playerId,
    roomId: room.id,
    name: playerName,
    joinedAt: now,
    lastSeenAt: now,
    role,
    score: 0,
    scoreReachedAt: null,
    puzzleIdx: 0,
    participated: 0,
  });
  const snapshot = await getRoomSnapshot(room.id, playerId);
  if (!snapshot || isErr(snapshot)) return err("Could not join the room.", 500);
  notifyRoomChange(room.id);
  return { room: snapshot };
}

export async function leaveRoom(input: {
  roomId: string;
  playerId: string;
  newHostId?: string;
}): Promise<{ ok: true; deleted: boolean } | RoomError> {
  const now = Date.now();
  const player = await getRoomPlayer(input.playerId);
  if (!player || player.roomId !== input.roomId) return err("not in room", 404);
  const room = await getRoom(input.roomId);
  if (!room) return err("room not found", 404);
  if (room.hostId === input.playerId && input.newHostId) {
    const next = await getRoomPlayer(input.newHostId);
    if (!next || next.roomId !== input.roomId) return err("invalid host", 400);
  }
  const result = await removePlayerFromRoom(
    input.roomId,
    input.playerId,
    room.hostId === input.playerId ? input.newHostId : undefined,
    now
  );
  return { ok: true, deleted: result.deleted };
}

export async function kickPlayer(input: {
  roomId: string;
  playerId: string;
  targetId: string;
}): Promise<{ ok: true } | RoomError> {
  const now = Date.now();
  const room = await getRoom(input.roomId);
  if (!room) return err("room not found", 404);
  if (room.hostId !== input.playerId) return err("forbidden", 403);
  if (input.targetId === input.playerId) return err("cannot kick yourself", 400);
  const target = await getRoomPlayer(input.targetId);
  if (!target || target.roomId !== input.roomId) return err("player not found", 404);
  const kicker = await getRoomPlayer(input.playerId);
  await insertRoomKick({
    playerId: input.targetId,
    roomId: room.id,
    roomName: room.name,
    kickedBy: kicker?.name ?? "the host",
    createdAt: now,
  });
  await removePlayerFromRoom(input.roomId, input.targetId, undefined, now);
  await updateRoomPlayer(input.playerId, { lastSeenAt: now });
  return { ok: true };
}

export async function setRoundDuration(input: {
  roomId: string;
  playerId: string;
  durationMs: number;
}): Promise<{ room: RoomStateView } | RoomError> {
  const now = Date.now();
  const room = await getRoom(input.roomId);
  if (!room) return err("Room not found.", 404);
  if (room.hostId !== input.playerId) return err("Only the host can change the round length.", 403);
  if (room.status === "playing") return err("The round already started.", 409);
  if (!isValidRoundDurationMs(input.durationMs)) {
    return err("Use 1–10 minutes.", 400);
  }
  await updateRoom(room.id, { roundDurationMs: input.durationMs, updatedAt: now });
  await updateRoomPlayer(input.playerId, { lastSeenAt: now });
  notifyRoomChange(room.id);
  const snapshot = await getRoomSnapshot(room.id, input.playerId);
  if (!snapshot || isErr(snapshot)) return err("Could not update round length.", 500);
  return { room: snapshot };
}

export async function startRound(input: {
  roomId: string;
  playerId: string;
}): Promise<{ room: RoomStateView } | RoomError> {
  const now = Date.now();
  let room = await getRoom(input.roomId);
  if (!room) return err("room not found", 404);
  if (room.hostId !== input.playerId) return err("forbidden", 403);
  await sweepRoom(room.id, now, input.playerId);
  room = await getRoom(input.roomId);
  if (!room) return err("room not found", 404);
  if (room.status === "playing") return err("Round already in progress.", 409);

  const durationMs = isValidRoundDurationMs(room.roundDurationMs)
    ? room.roundDurationMs
    : minutesToRoundMs(roundMsToMinutes(room.roundDurationMs));

  const round = room.round + 1;
  await ensurePuzzles(room.id, round, 1);
  await resetRoomPlayersForRound(room.id, now);
  await updateRoom(room.id, {
    status: "playing",
    round,
    roundStartedAt: now,
    roundEndsAt: now + durationMs,
    updatedAt: now,
  });
  notifyRoomChange(room.id);
  void ensurePuzzles(room.id, round, INITIAL_PUZZLES).catch(() => {});
  const snapshot = await getRoomSnapshot(room.id, input.playerId);
  if (!snapshot || isErr(snapshot)) return err("failed to start", 500);
  return { room: snapshot };
}

export async function endRound(input: {
  roomId: string;
  playerId: string;
}): Promise<{ room: RoomStateView } | RoomError> {
  const now = Date.now();
  const room = await getRoom(input.roomId);
  if (!room) return err("room not found", 404);
  if (room.hostId !== input.playerId) return err("forbidden", 403);
  if (room.status !== "playing") return err("round is not in progress", 409);
  await updateRoom(room.id, {
    status: "results",
    roundEndsAt: now,
    updatedAt: now,
  });
  await updateRoomPlayer(input.playerId, { lastSeenAt: now });
  notifyRoomChange(room.id);
  const snapshot = await getRoomSnapshot(room.id, input.playerId);
  if (!snapshot || isErr(snapshot)) return err("failed to end round", 500);
  return { room: snapshot };
}

export async function submitSolve(input: {
  roomId: string;
  playerId: string;
  idx: number;
  finalExpr: string;
}): Promise<{ room: RoomStateView } | RoomError> {
  const now = Date.now();
  let room = await getRoom(input.roomId);
  if (!room) return err("room not found", 404);
  room = await maybeEndRound(room, now);
  if (room.status !== "playing") return err("round is not in progress", 409);
  if (room.roundEndsAt != null && now >= room.roundEndsAt) {
    return err("round ended", 410);
  }

  const player = await getRoomPlayer(input.playerId);
  if (!player || player.roomId !== input.roomId) return err("not in room", 404);
  if (player.role !== "active" || !player.participated) {
    return err("not playing", 403);
  }
  if (input.idx !== player.puzzleIdx) return err("wrong puzzle", 400);

  const puzzle = await getRoomPuzzle(room.id, room.round, input.idx);
  if (!puzzle) return err("invalid puzzle", 404);
  const cards = JSON.parse(puzzle.cardsJson) as number[];
  const expr = input.finalExpr.trim();
  if (!expr || !validateFinalExpr(expr, cards, puzzle.goal)) {
    return err("invalid solution", 400);
  }

  await upsertRoomSolve({
    roomId: room.id,
    round: room.round,
    playerId: input.playerId,
    idx: input.idx,
    finalExpr: expr,
  });
  await updateRoomPlayer(input.playerId, {
    lastSeenAt: now,
    score: player.score + 1,
    scoreReachedAt: now,
    puzzleIdx: player.puzzleIdx + 1,
  });
  notifyRoomChange(room.id);
  void ensurePuzzles(room.id, room.round, player.puzzleIdx + 1 + PREFETCH_COUNT).catch(() => {});
  const snapshot = await getRoomSnapshot(room.id, input.playerId);
  if (!snapshot || isErr(snapshot)) return err("failed to record solve", 500);
  return { room: snapshot };
}

function toPuzzles(rows: { idx: number; goal: number; cardsJson: string }[]): RoomPuzzleView[] {
  return rows.map((r) => {
    const cards = JSON.parse(r.cardsJson) as number[];
    return { idx: r.idx, goal: r.goal, cards };
  });
}

export async function getRoomSnapshot(
  roomId: string,
  playerId: string,
  opts?: { since?: string; waitMs?: number; signal?: AbortSignal }
): Promise<RoomStateView | RoomError> {
  const since = opts?.since ?? "";
  const waitMs = Math.min(ROOM_LONG_POLL_MS, Math.max(0, opts?.waitMs ?? 0));
  const signal = opts?.signal;
  if (since && waitMs > 0) {
    const deadline = Date.now() + waitMs;
    while (!signal?.aborted && Date.now() < deadline) {
      const state = await getRoomSyncState(roomId);
      if (!state || state.cursor !== since) break;
      const now = Date.now();
      if (
        state.status === "playing" &&
        state.roundEndsAt != null &&
        now >= state.roundEndsAt
      ) {
        break;
      }
      const remaining = deadline - now;
      if (remaining <= 0) break;
      let slice = Math.min(ROOM_WAIT_SLICE_MS, remaining);
      if (state.status === "playing" && state.roundEndsAt != null) {
        slice = Math.min(slice, Math.max(0, state.roundEndsAt - now));
      }
      if (slice <= 0) break;
      await waitForRoomNotify(roomId, slice, signal);
    }
  }

  const now = Date.now();
  await sweepRoom(roomId, now, playerId);
  let room = await getRoom(roomId);
  const you = room ? await getRoomPlayer(playerId) : null;
  if (!room || !you || you.roomId !== roomId) {
    const kick = await consumeRoomKick(playerId, roomId);
    if (kick) return kickedErr(kick.roomName, kick.kickedBy);
    if (!room) return err("room not found", 404);
    return err("not in room", 404);
  }
  room = await maybeEndRound(room, now);
  await updateRoomPlayer(playerId, { lastSeenAt: now });

  const players = await listRoomPlayers(roomId);
  const host = players.find((p) => p.id === room.hostId);

  if (room.status === "playing" && you.role === "active" && you.participated) {
    await ensurePuzzles(room.id, room.round, you.puzzleIdx);
    void ensurePuzzles(room.id, room.round, you.puzzleIdx + PREFETCH_COUNT).catch(() => {});
  }

  let puzzles: RoomPuzzleView[] = [];
  if (room.status === "playing" && you.role === "active" && you.participated && you.puzzleIdx >= 1) {
    const rows = await listRoomPuzzles(
      room.id,
      room.round,
      you.puzzleIdx,
      you.puzzleIdx + PREFETCH_COUNT
    );
    puzzles = toPuzzles(rows);
  } else if (room.status === "results") {
    const throughIdx = Math.max(
      1,
      ...players.map((p) => (p.participated ? p.puzzleIdx : 0))
    );
    const rows = await listRoomPuzzles(room.id, room.round, 1, throughIdx);
    const solves = await listRoomSolvesForPlayer(room.id, room.round, playerId);
    const exprByIdx = new Map(solves.map((s) => [s.idx, s.finalExpr]));
    puzzles = toPuzzles(rows).map((p) => ({
      ...p,
      yourExpr: exprByIdx.get(p.idx) ?? null,
    }));
  }

  const hideIds = room.hostId !== playerId;
  const playerViews: RoomPlayerView[] = players.map((p) => ({
    id: hideIds && p.id !== playerId ? "" : p.id,
    name: p.name,
    isHost: p.id === room.hostId,
    role: p.role,
    score: p.score,
    scoreReachedAt: p.scoreReachedAt,
    participated: p.participated === 1,
  }));

  const rawLeader = computeLeader(players);

  return {
    id: room.id,
    name: room.name,
    status: room.status,
    isPrivate: room.isPrivate === 1,
    hostId: hideIds ? "" : room.hostId,
    hostName: host?.name ?? "Unknown",
    round: room.round,
    roundStartedAt: room.roundStartedAt,
    roundEndsAt: room.roundEndsAt,
    roundDurationMs: room.roundDurationMs,
    you: {
      playerId: you.id,
      name: you.name,
      isHost: you.id === room.hostId,
      role: you.role,
      score: you.score,
      puzzleIdx: you.puzzleIdx,
      participated: you.participated === 1,
    },
    players: playerViews,
    leader: rawLeader
      ? {
          name: rawLeader.name,
          score: rawLeader.score,
          isYou: rawLeader.playerId === playerId,
        }
      : null,
    puzzles,
    sync: formatRoomSyncCursor({
      status: room.status,
      round: room.round,
      updatedAt: room.updatedAt,
      hostId: room.hostId,
      playerCount: players.length,
      scoreSum: players.reduce((sum, p) => sum + p.score, 0),
      maxScoreReachedAt: players.reduce((m, p) => Math.max(m, p.scoreReachedAt ?? 0), 0),
    }),
  };
}

export async function adminDeleteRoom(id: string): Promise<boolean> {
  return deleteRoomCascade(id);
}
