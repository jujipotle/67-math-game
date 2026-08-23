import { randomUUID } from "node:crypto";
import { getNeon, getSqliteDb, useNeon } from "./db";
import type { RoomPlayerRole, RoomStatus } from "./types";
import { DEFAULT_ROUND_MS } from "./duration";

export type RoomRow = {
  id: string;
  name: string;
  hostId: string;
  isPrivate: number;
  passwordHash: string | null;
  status: RoomStatus;
  round: number;
  roundStartedAt: number | null;
  roundEndsAt: number | null;
  roundDurationMs: number;
  createdAt: number;
  updatedAt: number;
};

export type RoomPlayerRow = {
  id: string;
  roomId: string;
  name: string;
  joinedAt: number;
  lastSeenAt: number;
  role: RoomPlayerRole;
  score: number;
  scoreReachedAt: number | null;
  puzzleIdx: number;
  participated: number;
};

export type RoomPuzzleRow = {
  roomId: string;
  round: number;
  idx: number;
  goal: number;
  cardsJson: string;
};

function num(v: unknown): number {
  return Number(v);
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  return Number(v);
}

function mapRoom(r: Record<string, unknown>): RoomRow {
  return {
    id: String(r.id),
    name: String(r.name),
    hostId: String(r.hostId),
    isPrivate: num(r.isPrivate),
    passwordHash: r.passwordHash == null ? null : String(r.passwordHash),
    status: r.status as RoomStatus,
    round: num(r.round),
    roundStartedAt: numOrNull(r.roundStartedAt),
    roundEndsAt: numOrNull(r.roundEndsAt),
    roundDurationMs:
      Number.isFinite(num(r.roundDurationMs)) && num(r.roundDurationMs) >= 1000
        ? num(r.roundDurationMs)
        : DEFAULT_ROUND_MS,
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  };
}

function mapPlayer(r: Record<string, unknown>): RoomPlayerRow {
  return {
    id: String(r.id),
    roomId: String(r.roomId),
    name: String(r.name),
    joinedAt: num(r.joinedAt),
    lastSeenAt: num(r.lastSeenAt),
    role: r.role as RoomPlayerRole,
    score: num(r.score),
    scoreReachedAt: numOrNull(r.scoreReachedAt),
    puzzleIdx: num(r.puzzleIdx),
    participated: num(r.participated),
  };
}

export async function insertRoom(row: RoomRow): Promise<void> {
  if (useNeon) {
    const sql = await getNeon();
    await sql`
      INSERT INTO rooms (
        id, name, "hostId", "isPrivate", "passwordHash", status, round,
        "roundStartedAt", "roundEndsAt", "roundDurationMs", "createdAt", "updatedAt"
      ) VALUES (
        ${row.id}, ${row.name}, ${row.hostId}, ${row.isPrivate}, ${row.passwordHash},
        ${row.status}, ${row.round}, ${row.roundStartedAt}, ${row.roundEndsAt},
        ${row.roundDurationMs}, ${row.createdAt}, ${row.updatedAt}
      )
    `;
    return;
  }
  getSqliteDb()
    .prepare(
      `INSERT INTO rooms (
        id, name, hostId, isPrivate, passwordHash, status, round,
        roundStartedAt, roundEndsAt, roundDurationMs, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.name,
      row.hostId,
      row.isPrivate,
      row.passwordHash,
      row.status,
      row.round,
      row.roundStartedAt,
      row.roundEndsAt,
      row.roundDurationMs,
      row.createdAt,
      row.updatedAt
    );
}

export async function getRoom(id: string): Promise<RoomRow | null> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      SELECT id, name, "hostId" as "hostId", "isPrivate" as "isPrivate",
             "passwordHash" as "passwordHash", status, round,
             "roundStartedAt" as "roundStartedAt", "roundEndsAt" as "roundEndsAt",
             "roundDurationMs" as "roundDurationMs",
             "createdAt" as "createdAt", "updatedAt" as "updatedAt"
      FROM rooms WHERE id = ${id}
    `;
    const r = rows[0] as Record<string, unknown> | undefined;
    return r ? mapRoom(r) : null;
  }
  const r = getSqliteDb()
    .prepare(
      `SELECT id, name, hostId, isPrivate, passwordHash, status, round,
              roundStartedAt, roundEndsAt, roundDurationMs, createdAt, updatedAt
       FROM rooms WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  return r ? mapRoom(r) : null;
}

export async function getRoomByName(name: string): Promise<RoomRow | null> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      SELECT id, name, "hostId" as "hostId", "isPrivate" as "isPrivate",
             "passwordHash" as "passwordHash", status, round,
             "roundStartedAt" as "roundStartedAt", "roundEndsAt" as "roundEndsAt",
             "roundDurationMs" as "roundDurationMs",
             "createdAt" as "createdAt", "updatedAt" as "updatedAt"
      FROM rooms WHERE lower(name) = ${name.toLowerCase()}
    `;
    const r = rows[0] as Record<string, unknown> | undefined;
    return r ? mapRoom(r) : null;
  }
  const r = getSqliteDb()
    .prepare(
      `SELECT id, name, hostId, isPrivate, passwordHash, status, round,
              roundStartedAt, roundEndsAt, roundDurationMs, createdAt, updatedAt
       FROM rooms WHERE lower(name) = lower(?)`
    )
    .get(name) as Record<string, unknown> | undefined;
  return r ? mapRoom(r) : null;
}

export async function listRooms(): Promise<RoomRow[]> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      SELECT id, name, "hostId" as "hostId", "isPrivate" as "isPrivate",
             "passwordHash" as "passwordHash", status, round,
             "roundStartedAt" as "roundStartedAt", "roundEndsAt" as "roundEndsAt",
             "roundDurationMs" as "roundDurationMs",
             "createdAt" as "createdAt", "updatedAt" as "updatedAt"
      FROM rooms ORDER BY "createdAt" DESC
    `;
    return (rows as Record<string, unknown>[]).map(mapRoom);
  }
  const rows = getSqliteDb()
    .prepare(
      `SELECT id, name, hostId, isPrivate, passwordHash, status, round,
              roundStartedAt, roundEndsAt, roundDurationMs, createdAt, updatedAt
       FROM rooms ORDER BY createdAt DESC`
    )
    .all() as Record<string, unknown>[];
  return rows.map(mapRoom);
}

export async function listRoomNames(): Promise<string[]> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`SELECT name FROM rooms`;
    return (rows as { name: string }[]).map((r) => r.name);
  }
  const rows = getSqliteDb().prepare(`SELECT name FROM rooms`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

export type RoomSyncState = {
  cursor: string;
  status: RoomStatus;
  roundEndsAt: number | null;
};

export function formatRoomSyncCursor(parts: {
  status: string;
  round: number;
  updatedAt: number;
  hostId: string;
  playerCount: number;
  scoreSum: number;
  maxScoreReachedAt: number;
}): string {
  return [
    parts.status,
    parts.round,
    parts.updatedAt,
    parts.hostId,
    parts.playerCount,
    parts.scoreSum,
    parts.maxScoreReachedAt,
  ].join(":");
}

export async function getRoomSyncState(id: string): Promise<RoomSyncState | null> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      SELECT r.status as status, r.round as round, r."updatedAt" as "updatedAt",
             r."hostId" as "hostId", r."roundEndsAt" as "roundEndsAt",
             (SELECT COUNT(*) FROM room_players WHERE "roomId" = r.id) as n,
             (SELECT COALESCE(SUM(score), 0) FROM room_players WHERE "roomId" = r.id) as "scoreSum",
             (SELECT COALESCE(MAX("scoreReachedAt"), 0) FROM room_players WHERE "roomId" = r.id) as "maxAt"
      FROM rooms r WHERE r.id = ${id}
    `;
    const r = (rows as Record<string, unknown>[])[0];
    if (!r) return null;
    return {
      status: r.status as RoomStatus,
      roundEndsAt: numOrNull(r.roundEndsAt),
      cursor: formatRoomSyncCursor({
        status: String(r.status),
        round: num(r.round),
        updatedAt: num(r.updatedAt),
        hostId: String(r.hostId),
        playerCount: num(r.n),
        scoreSum: num(r.scoreSum),
        maxScoreReachedAt: num(r.maxAt),
      }),
    };
  }
  const r = getSqliteDb()
    .prepare(
      `SELECT status, round, updatedAt, hostId, roundEndsAt,
              (SELECT COUNT(*) FROM room_players WHERE roomId = rooms.id) AS n,
              (SELECT COALESCE(SUM(score), 0) FROM room_players WHERE roomId = rooms.id) AS scoreSum,
              (SELECT COALESCE(MAX(scoreReachedAt), 0) FROM room_players WHERE roomId = rooms.id) AS maxAt
       FROM rooms WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    status: r.status as RoomStatus,
    roundEndsAt: numOrNull(r.roundEndsAt),
    cursor: formatRoomSyncCursor({
      status: String(r.status),
      round: num(r.round),
      updatedAt: num(r.updatedAt),
      hostId: String(r.hostId),
      playerCount: num(r.n),
      scoreSum: num(r.scoreSum),
      maxScoreReachedAt: num(r.maxAt),
    }),
  };
}

export async function updateRoom(
  id: string,
  patch: Partial<
    Pick<
      RoomRow,
      | "hostId"
      | "status"
      | "round"
      | "roundStartedAt"
      | "roundEndsAt"
      | "roundDurationMs"
      | "updatedAt"
    >
  >
): Promise<void> {
  const current = await getRoom(id);
  if (!current) return;
  const next: RoomRow = { ...current, ...patch };
  if (useNeon) {
    const sql = await getNeon();
    await sql`
      UPDATE rooms SET
        "hostId" = ${next.hostId},
        status = ${next.status},
        round = ${next.round},
        "roundStartedAt" = ${next.roundStartedAt},
        "roundEndsAt" = ${next.roundEndsAt},
        "roundDurationMs" = ${next.roundDurationMs},
        "updatedAt" = ${next.updatedAt}
      WHERE id = ${id}
    `;
    return;
  }
  getSqliteDb()
    .prepare(
      `UPDATE rooms SET hostId = ?, status = ?, round = ?, roundStartedAt = ?,
       roundEndsAt = ?, roundDurationMs = ?, updatedAt = ? WHERE id = ?`
    )
    .run(
      next.hostId,
      next.status,
      next.round,
      next.roundStartedAt,
      next.roundEndsAt,
      next.roundDurationMs,
      next.updatedAt,
      id
    );
}

export async function deleteRoomCascade(id: string): Promise<boolean> {
  if (useNeon) {
    const sql = await getNeon();
    await sql`DELETE FROM room_puzzles WHERE "roomId" = ${id}`;
    await sql`DELETE FROM room_players WHERE "roomId" = ${id}`;
    const rows = await sql`DELETE FROM rooms WHERE id = ${id} RETURNING id`;
    return Array.isArray(rows) && rows.length > 0;
  }
  const d = getSqliteDb();
  const tx = d.transaction((roomId: string) => {
    d.prepare(`DELETE FROM room_puzzles WHERE roomId = ?`).run(roomId);
    d.prepare(`DELETE FROM room_players WHERE roomId = ?`).run(roomId);
    return d.prepare(`DELETE FROM rooms WHERE id = ?`).run(roomId);
  });
  const res = tx(id);
  return res.changes > 0;
}

export async function insertRoomPlayer(row: RoomPlayerRow): Promise<void> {
  if (useNeon) {
    const sql = await getNeon();
    await sql`
      INSERT INTO room_players (
        id, "roomId", name, "joinedAt", "lastSeenAt", role, score,
        "scoreReachedAt", "puzzleIdx", participated
      ) VALUES (
        ${row.id}, ${row.roomId}, ${row.name}, ${row.joinedAt}, ${row.lastSeenAt},
        ${row.role}, ${row.score}, ${row.scoreReachedAt}, ${row.puzzleIdx}, ${row.participated}
      )
    `;
    return;
  }
  getSqliteDb()
    .prepare(
      `INSERT INTO room_players (
        id, roomId, name, joinedAt, lastSeenAt, role, score,
        scoreReachedAt, puzzleIdx, participated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.roomId,
      row.name,
      row.joinedAt,
      row.lastSeenAt,
      row.role,
      row.score,
      row.scoreReachedAt,
      row.puzzleIdx,
      row.participated
    );
}

export async function getRoomPlayer(id: string): Promise<RoomPlayerRow | null> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      SELECT id, "roomId" as "roomId", name, "joinedAt" as "joinedAt",
             "lastSeenAt" as "lastSeenAt", role, score,
             "scoreReachedAt" as "scoreReachedAt", "puzzleIdx" as "puzzleIdx",
             participated
      FROM room_players WHERE id = ${id}
    `;
    const r = rows[0] as Record<string, unknown> | undefined;
    return r ? mapPlayer(r) : null;
  }
  const r = getSqliteDb()
    .prepare(
      `SELECT id, roomId, name, joinedAt, lastSeenAt, role, score,
              scoreReachedAt, puzzleIdx, participated
       FROM room_players WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  return r ? mapPlayer(r) : null;
}

export async function listRoomPlayers(roomId: string): Promise<RoomPlayerRow[]> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      SELECT id, "roomId" as "roomId", name, "joinedAt" as "joinedAt",
             "lastSeenAt" as "lastSeenAt", role, score,
             "scoreReachedAt" as "scoreReachedAt", "puzzleIdx" as "puzzleIdx",
             participated
      FROM room_players WHERE "roomId" = ${roomId} ORDER BY "joinedAt" ASC
    `;
    return (rows as Record<string, unknown>[]).map(mapPlayer);
  }
  const rows = getSqliteDb()
    .prepare(
      `SELECT id, roomId, name, joinedAt, lastSeenAt, role, score,
              scoreReachedAt, puzzleIdx, participated
       FROM room_players WHERE roomId = ? ORDER BY joinedAt ASC`
    )
    .all(roomId) as Record<string, unknown>[];
  return rows.map(mapPlayer);
}

const PLAYER_PATCH_COLS: {
  lastSeenAt: string;
  role: string;
  score: string;
  scoreReachedAt: string;
  puzzleIdx: string;
  participated: string;
} = {
  lastSeenAt: "lastSeenAt",
  role: "role",
  score: "score",
  scoreReachedAt: "scoreReachedAt",
  puzzleIdx: "puzzleIdx",
  participated: "participated",
};

type PlayerPatch = Partial<
  Pick<
    RoomPlayerRow,
    | "lastSeenAt"
    | "role"
    | "score"
    | "scoreReachedAt"
    | "puzzleIdx"
    | "participated"
  >
>;

/** Writes only the provided columns so a heartbeat cannot clobber a concurrent solve. */
export async function updateRoomPlayer(id: string, patch: PlayerPatch): Promise<void> {
  const keys = (Object.keys(PLAYER_PATCH_COLS) as (keyof typeof PLAYER_PATCH_COLS)[]).filter(
    (k) => patch[k] !== undefined
  );
  if (keys.length === 0) return;

  if (useNeon) {
    const sql = await getNeon();
    for (const k of keys) {
      const v = patch[k];
      if (k === "lastSeenAt") {
        await sql`UPDATE room_players SET "lastSeenAt" = ${v} WHERE id = ${id}`;
      } else if (k === "role") {
        await sql`UPDATE room_players SET role = ${v} WHERE id = ${id}`;
      } else if (k === "score") {
        await sql`UPDATE room_players SET score = ${v} WHERE id = ${id}`;
      } else if (k === "scoreReachedAt") {
        await sql`UPDATE room_players SET "scoreReachedAt" = ${v} WHERE id = ${id}`;
      } else if (k === "puzzleIdx") {
        await sql`UPDATE room_players SET "puzzleIdx" = ${v} WHERE id = ${id}`;
      } else if (k === "participated") {
        await sql`UPDATE room_players SET participated = ${v} WHERE id = ${id}`;
      }
    }
    return;
  }

  const sets = keys.map((k) => `${PLAYER_PATCH_COLS[k]} = ?`).join(", ");
  const values = keys.map((k) => patch[k]);
  getSqliteDb()
    .prepare(`UPDATE room_players SET ${sets} WHERE id = ?`)
    .run(...values, id);
}

export async function resetRoomPlayersForRound(
  roomId: string,
  now: number
): Promise<void> {
  if (useNeon) {
    const sql = await getNeon();
    await sql`
      UPDATE room_players SET
        role = 'active',
        score = 0,
        "scoreReachedAt" = NULL,
        "puzzleIdx" = 1,
        participated = 1,
        "lastSeenAt" = ${now}
      WHERE "roomId" = ${roomId}
    `;
    return;
  }
  getSqliteDb()
    .prepare(
      `UPDATE room_players SET role = 'active', score = 0, scoreReachedAt = NULL,
       puzzleIdx = 1, participated = 1, lastSeenAt = ? WHERE roomId = ?`
    )
    .run(now, roomId);
}

export async function deleteRoomPlayer(id: string): Promise<void> {
  if (useNeon) {
    const sql = await getNeon();
    await sql`DELETE FROM room_players WHERE id = ${id}`;
    return;
  }
  getSqliteDb().prepare(`DELETE FROM room_players WHERE id = ?`).run(id);
}

export async function upsertRoomPuzzle(row: RoomPuzzleRow): Promise<void> {
  if (useNeon) {
    const sql = await getNeon();
    await sql`
      INSERT INTO room_puzzles ("roomId", round, idx, goal, "cardsJson")
      VALUES (${row.roomId}, ${row.round}, ${row.idx}, ${row.goal}, ${row.cardsJson})
      ON CONFLICT ("roomId", round, idx) DO NOTHING
    `;
    return;
  }
  getSqliteDb()
    .prepare(
      `INSERT OR IGNORE INTO room_puzzles (roomId, round, idx, goal, cardsJson)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(row.roomId, row.round, row.idx, row.goal, row.cardsJson);
}

export async function listRoomPuzzles(
  roomId: string,
  round: number,
  fromIdx: number,
  toIdx: number
): Promise<RoomPuzzleRow[]> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      SELECT "roomId" as "roomId", round, idx, goal, "cardsJson" as "cardsJson"
      FROM room_puzzles
      WHERE "roomId" = ${roomId} AND round = ${round} AND idx >= ${fromIdx} AND idx <= ${toIdx}
      ORDER BY idx ASC
    `;
    return rows as RoomPuzzleRow[];
  }
  return getSqliteDb()
    .prepare(
      `SELECT roomId, round, idx, goal, cardsJson FROM room_puzzles
       WHERE roomId = ? AND round = ? AND idx >= ? AND idx <= ? ORDER BY idx ASC`
    )
    .all(roomId, round, fromIdx, toIdx) as RoomPuzzleRow[];
}

export async function getRoomPuzzle(
  roomId: string,
  round: number,
  idx: number
): Promise<RoomPuzzleRow | null> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      SELECT "roomId" as "roomId", round, idx, goal, "cardsJson" as "cardsJson"
      FROM room_puzzles
      WHERE "roomId" = ${roomId} AND round = ${round} AND idx = ${idx}
    `;
    return (rows[0] as RoomPuzzleRow) ?? null;
  }
  return (
    (getSqliteDb()
      .prepare(
        `SELECT roomId, round, idx, goal, cardsJson FROM room_puzzles
         WHERE roomId = ? AND round = ? AND idx = ?`
      )
      .get(roomId, round, idx) as RoomPuzzleRow | undefined) ?? null
  );
}

export async function getRoomMaxPuzzleIdx(roomId: string, round: number): Promise<number> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      SELECT COALESCE(MAX(idx), 0) as "maxIdx" FROM room_puzzles
      WHERE "roomId" = ${roomId} AND round = ${round}
    `;
    return Number((rows[0] as { maxIdx: string | number })?.maxIdx ?? 0);
  }
  const row = getSqliteDb()
    .prepare(
      `SELECT COALESCE(MAX(idx), 0) AS maxIdx FROM room_puzzles WHERE roomId = ? AND round = ?`
    )
    .get(roomId, round) as { maxIdx: number } | undefined;
  return row?.maxIdx ?? 0;
}

export function newId(): string {
  return randomUUID();
}

export type RoomKickRow = {
  playerId: string;
  roomId: string;
  roomName: string;
  kickedBy: string;
  createdAt: number;
};

export async function insertRoomKick(row: RoomKickRow): Promise<void> {
  if (useNeon) {
    const sql = await getNeon();
    await sql`
      INSERT INTO room_kicks ("playerId", "roomId", "roomName", "kickedBy", "createdAt")
      VALUES (${row.playerId}, ${row.roomId}, ${row.roomName}, ${row.kickedBy}, ${row.createdAt})
      ON CONFLICT ("playerId") DO UPDATE SET
        "roomId" = ${row.roomId},
        "roomName" = ${row.roomName},
        "kickedBy" = ${row.kickedBy},
        "createdAt" = ${row.createdAt}
    `;
    return;
  }
  getSqliteDb()
    .prepare(
      `INSERT INTO room_kicks (playerId, roomId, roomName, kickedBy, createdAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(playerId) DO UPDATE SET
         roomId = excluded.roomId,
         roomName = excluded.roomName,
         kickedBy = excluded.kickedBy,
         createdAt = excluded.createdAt`
    )
    .run(row.playerId, row.roomId, row.roomName, row.kickedBy, row.createdAt);
}

/** One-shot: returns the kick and deletes it so a later poll does not repeat it. */
export async function consumeRoomKick(
  playerId: string,
  roomId: string
): Promise<RoomKickRow | null> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      DELETE FROM room_kicks
      WHERE "playerId" = ${playerId} AND "roomId" = ${roomId}
      RETURNING "playerId" as "playerId", "roomId" as "roomId",
                "roomName" as "roomName", "kickedBy" as "kickedBy",
                "createdAt" as "createdAt"
    `;
    const r = rows[0] as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      playerId: String(r.playerId),
      roomId: String(r.roomId),
      roomName: String(r.roomName),
      kickedBy: String(r.kickedBy),
      createdAt: Number(r.createdAt),
    };
  }
  const d = getSqliteDb();
  const row = d
    .prepare(
      `SELECT playerId, roomId, roomName, kickedBy, createdAt
       FROM room_kicks WHERE playerId = ? AND roomId = ?`
    )
    .get(playerId, roomId) as RoomKickRow | undefined;
  if (!row) return null;
  d.prepare(`DELETE FROM room_kicks WHERE playerId = ? AND roomId = ?`).run(playerId, roomId);
  return row;
}

export async function expireRoomKicks(now: number, maxAgeMs: number): Promise<void> {
  const cutoff = now - maxAgeMs;
  if (useNeon) {
    const sql = await getNeon();
    await sql`DELETE FROM room_kicks WHERE "createdAt" < ${cutoff}`;
    return;
  }
  getSqliteDb().prepare(`DELETE FROM room_kicks WHERE createdAt < ?`).run(cutoff);
}
