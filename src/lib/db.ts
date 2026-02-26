import { randomUUID } from "node:crypto";

export type LeaderboardKind = "old" | "new";

export type LeaderboardEntry = {
  id: number;
  name: string;
  score: number;
  createdAt: number;
  kind: LeaderboardKind;
};

export type SprintSessionRow = {
  id: string;
  startedAt: number;
  endsAt: number;
  solved: number;
  submitted: number;
};

const useNeon =
  typeof process !== "undefined" &&
  (!!process.env.DATABASE_URL || !!process.env.POSTGRES_URL);

/** Accepts Neon's sql tagged-template function (typed loosely to avoid Neon generic mismatch). */
async function initNeonSchema(
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
) {
  await sql`
    CREATE TABLE IF NOT EXISTS leaderboard_entries (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      score INTEGER NOT NULL,
      "createdAt" BIGINT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'old'
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS sprint_sessions (
      id TEXT PRIMARY KEY,
      "startedAt" BIGINT NOT NULL,
      "endsAt" BIGINT NOT NULL,
      solved INTEGER NOT NULL,
      submitted INTEGER NOT NULL DEFAULT 0
    )
  `;
  // Backfill kind column on existing Neon databases that predate it.
  try {
    await sql`
      ALTER TABLE leaderboard_entries
      ADD COLUMN kind TEXT NOT NULL DEFAULT 'old'
    `;
  } catch {
    // Column already exists – ignore.
  }
  await sql`
    CREATE TABLE IF NOT EXISTS sprint_puzzles (
      "sessionId" TEXT NOT NULL,
      idx INTEGER NOT NULL,
      goal INTEGER NOT NULL,
      "cardsJson" TEXT NOT NULL,
      "issuedAt" BIGINT NOT NULL,
      status TEXT NOT NULL,
      "finalExpr" TEXT,
      PRIMARY KEY ("sessionId", idx)
    )
  `;
}

// ---- Neon (async) path ----
async function neonDb() {
  const { neon } = await import("@neondatabase/serverless");
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("DATABASE_URL or POSTGRES_URL required");
  const sql = neon(connectionString);
  await initNeonSchema(sql);
  return sql;
}

let neonSql: Awaited<ReturnType<typeof neonDb>> | null = null;

async function getNeon() {
  if (neonSql) return neonSql;
  neonSql = await neonDb();
  return neonSql;
}

export async function createSprintSession(
  nowMs: number,
  durationMs: number
): Promise<SprintSessionRow> {
  if (useNeon) {
    const sql = await getNeon();
    const id = randomUUID();
    await sql`
      INSERT INTO sprint_sessions (id, "startedAt", "endsAt", solved, submitted)
      VALUES (${id}, ${nowMs}, ${nowMs + durationMs}, 0, 0)
    `;
    return { id, startedAt: nowMs, endsAt: nowMs + durationMs, solved: 0, submitted: 0 };
  }
  return sqliteCreateSprintSession(nowMs, durationMs);
}

export async function getSprintSession(id: string): Promise<SprintSessionRow | null> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      SELECT id, "startedAt" as "startedAt", "endsAt" as "endsAt", solved, submitted
      FROM sprint_sessions WHERE id = ${id}
    `;
    const r = rows[0] as { id: string; startedAt: string; endsAt: string; solved: number; submitted: number } | undefined;
    if (!r) return null;
    return {
      id: r.id,
      startedAt: Number(r.startedAt),
      endsAt: Number(r.endsAt),
      solved: r.solved,
      submitted: r.submitted,
    };
  }
  return Promise.resolve(sqliteGetSprintSession(id));
}

export async function updateSprintSolved(id: string, delta: number): Promise<void> {
  if (useNeon) {
    const sql = await getNeon();
    await sql`UPDATE sprint_sessions SET solved = solved + ${delta} WHERE id = ${id}`;
    return;
  }
  sqliteUpdateSprintSolved(id, delta);
}

export async function updateSprintEndsAt(id: string, endsAt: number): Promise<void> {
  if (useNeon) {
    const sql = await getNeon();
    await sql`UPDATE sprint_sessions SET "endsAt" = ${endsAt} WHERE id = ${id}`;
    return;
  }
  sqliteUpdateSprintEndsAt(id, endsAt);
}

export async function markSprintSubmitted(id: string): Promise<void> {
  if (useNeon) {
    const sql = await getNeon();
    await sql`UPDATE sprint_sessions SET submitted = 1 WHERE id = ${id}`;
    return;
  }
  sqliteMarkSprintSubmitted(id);
}

export async function insertLeaderboardEntry(
  name: string,
  score: number,
  createdAt: number,
  kind: LeaderboardKind
): Promise<number> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      INSERT INTO leaderboard_entries (name, score, "createdAt", kind)
      VALUES (${name}, ${score}, ${createdAt}, ${kind})
      RETURNING id
    `;
    const r = rows[0] as { id: number | string };
    return Number(r?.id ?? 0);
  }
  return Promise.resolve(sqliteInsertLeaderboardEntry(name, score, createdAt, kind));
}

export async function listLeaderboardEntries(
  limit: number,
  kind: LeaderboardKind
): Promise<LeaderboardEntry[]> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      SELECT id, name, score, "createdAt" as "createdAt", kind
      FROM leaderboard_entries
      WHERE kind = ${kind}
      ORDER BY score DESC, "createdAt" ASC
      LIMIT ${limit}
    `;
    return rows as LeaderboardEntry[];
  }
  return Promise.resolve(sqliteListLeaderboardEntries(limit, kind));
}

export async function deleteLeaderboardEntry(id: number): Promise<boolean> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`DELETE FROM leaderboard_entries WHERE id = ${id} RETURNING id`;
    return Array.isArray(rows) && rows.length > 0;
  }
  return Promise.resolve(sqliteDeleteLeaderboardEntry(id));
}

export async function updateLeaderboardEntry(params: {
  id: number;
  name: string;
  score: number;
  kind: LeaderboardKind;
}): Promise<boolean> {
  const { id, name, score, kind } = params;
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      UPDATE leaderboard_entries
      SET name = ${name}, score = ${score}, kind = ${kind}
      WHERE id = ${id}
      RETURNING id
    `;
    return Array.isArray(rows) && rows.length > 0;
  }
  return Promise.resolve(sqliteUpdateLeaderboardEntry({ id, name, score, kind }));
}

export async function upsertSprintPuzzle(params: {
  sessionId: string;
  idx: number;
  goal: number;
  cardsJson: string;
  issuedAt: number;
}): Promise<void> {
  if (useNeon) {
    const sql = await getNeon();
    await sql`
      INSERT INTO sprint_puzzles ("sessionId", idx, goal, "cardsJson", "issuedAt", status)
      VALUES (${params.sessionId}, ${params.idx}, ${params.goal}, ${params.cardsJson}, ${params.issuedAt}, 'issued')
      ON CONFLICT ("sessionId", idx) DO NOTHING
    `;
    return;
  }
  sqliteUpsertSprintPuzzle(params);
}

export async function getSprintPuzzle(
  sessionId: string,
  idx: number
): Promise<{
  sessionId: string;
  idx: number;
  goal: number;
  cardsJson: string;
  issuedAt: number;
  status: string;
  finalExpr: string | null;
} | null> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      SELECT "sessionId", idx, goal, "cardsJson", "issuedAt", status, "finalExpr"
      FROM sprint_puzzles WHERE "sessionId" = ${sessionId} AND idx = ${idx}
    `;
    const r = rows[0] as
      | {
          sessionId: string;
          idx: number;
          goal: number;
          cardsJson: string;
          issuedAt: number;
          status: string;
          finalExpr: string | null;
        }
      | undefined;
    return r ?? null;
  }
  return Promise.resolve(sqliteGetSprintPuzzle(sessionId, idx));
}

export async function updateSprintPuzzleStatus(params: {
  sessionId: string;
  idx: number;
  status: "solved" | "skipped";
  finalExpr: string | null;
}): Promise<void> {
  if (useNeon) {
    const sql = await getNeon();
    await sql`
      UPDATE sprint_puzzles
      SET status = ${params.status}, "finalExpr" = ${params.finalExpr}
      WHERE "sessionId" = ${params.sessionId} AND idx = ${params.idx}
    `;
    return;
  }
  sqliteUpdateSprintPuzzleStatus(params);
}

export async function getSprintMaxIdx(sessionId: string): Promise<number> {
  if (useNeon) {
    const sql = await getNeon();
    const rows = await sql`
      SELECT COALESCE(MAX(idx), 0) as "maxIdx" FROM sprint_puzzles WHERE "sessionId" = ${sessionId}
    `;
    const r = rows[0] as { maxIdx: string | number };
    return Number(r?.maxIdx ?? 0);
  }
  return Promise.resolve(sqliteGetSprintMaxIdx(sessionId));
}

// ---- SQLite (sync) path for local dev when no Postgres URL ----
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let sqliteDb: Database.Database | null = null;

function getSqliteDb(): Database.Database {
  if (sqliteDb) return sqliteDb;
  const dbPath = path.join(process.cwd(), "data", "leaderboard.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  sqliteDb = new Database(dbPath);
  sqliteDb.pragma("journal_mode = WAL");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS leaderboard_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      score INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'old'
    );
    CREATE TABLE IF NOT EXISTS sprint_sessions (
      id TEXT PRIMARY KEY,
      startedAt INTEGER NOT NULL,
      endsAt INTEGER NOT NULL,
      solved INTEGER NOT NULL,
      submitted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sprint_puzzles (
      sessionId TEXT NOT NULL,
      idx INTEGER NOT NULL,
      goal INTEGER NOT NULL,
      cardsJson TEXT NOT NULL,
      issuedAt INTEGER NOT NULL,
      status TEXT NOT NULL,
      finalExpr TEXT,
      PRIMARY KEY (sessionId, idx)
    );
  `);
  // Backfill kind column on existing SQLite databases that predate it.
  try {
    sqliteDb.exec(
      `ALTER TABLE leaderboard_entries ADD COLUMN kind TEXT NOT NULL DEFAULT 'old';`
    );
  } catch {
    // Ignore if the column already exists.
  }
  return sqliteDb;
}

function sqliteCreateSprintSession(nowMs: number, durationMs: number): SprintSessionRow {
  const id = randomUUID();
  const row: SprintSessionRow = {
    id,
    startedAt: nowMs,
    endsAt: nowMs + durationMs,
    solved: 0,
    submitted: 0,
  };
  const d = getSqliteDb();
  d.prepare(
    `INSERT INTO sprint_sessions (id, startedAt, endsAt, solved, submitted)
     VALUES (?, ?, ?, ?, ?)`
  ).run(row.id, row.startedAt, row.endsAt, row.solved, row.submitted);
  return row;
}

function sqliteGetSprintSession(id: string): SprintSessionRow | null {
  const row = getSqliteDb()
    .prepare(`SELECT id, startedAt, endsAt, solved, submitted FROM sprint_sessions WHERE id = ?`)
    .get(id) as SprintSessionRow | undefined;
  return row ?? null;
}

function sqliteUpdateSprintSolved(id: string, delta: number): void {
  getSqliteDb().prepare(`UPDATE sprint_sessions SET solved = solved + ? WHERE id = ?`).run(delta, id);
}

function sqliteUpdateSprintEndsAt(id: string, endsAt: number): void {
  getSqliteDb().prepare(`UPDATE sprint_sessions SET endsAt = ? WHERE id = ?`).run(endsAt, id);
}

function sqliteMarkSprintSubmitted(id: string): void {
  getSqliteDb().prepare(`UPDATE sprint_sessions SET submitted = 1 WHERE id = ?`).run(id);
}

function sqliteInsertLeaderboardEntry(
  name: string,
  score: number,
  createdAt: number,
  kind: LeaderboardKind
): number {
  const res = getSqliteDb()
    .prepare(
      `INSERT INTO leaderboard_entries (name, score, createdAt, kind) VALUES (?, ?, ?, ?)`
    )
    .run(name, score, createdAt, kind);
  return Number(res.lastInsertRowid);
}

function sqliteListLeaderboardEntries(
  limit: number,
  kind: LeaderboardKind
): LeaderboardEntry[] {
  return getSqliteDb()
    .prepare(
      `SELECT id, name, score, createdAt, kind FROM leaderboard_entries
       WHERE kind = ?
       ORDER BY score DESC, createdAt ASC LIMIT ?`
    )
    .all(kind, limit) as LeaderboardEntry[];
}

function sqliteDeleteLeaderboardEntry(id: number): boolean {
  const res = getSqliteDb().prepare(`DELETE FROM leaderboard_entries WHERE id = ?`).run(id);
  return res.changes > 0;
}

function sqliteUpdateLeaderboardEntry(params: {
  id: number;
  name: string;
  score: number;
  kind: LeaderboardKind;
}): boolean {
  const res = getSqliteDb()
    .prepare(`UPDATE leaderboard_entries SET name = ?, score = ?, kind = ? WHERE id = ?`)
    .run(params.name, params.score, params.kind, params.id);
  return res.changes > 0;
}

function sqliteUpsertSprintPuzzle(params: {
  sessionId: string;
  idx: number;
  goal: number;
  cardsJson: string;
  issuedAt: number;
}): void {
  getSqliteDb()
    .prepare(
      `INSERT INTO sprint_puzzles (sessionId, idx, goal, cardsJson, issuedAt, status)
       VALUES (?, ?, ?, ?, ?, 'issued')`
    )
    .run(params.sessionId, params.idx, params.goal, params.cardsJson, params.issuedAt);
}

function sqliteGetSprintPuzzle(sessionId: string, idx: number): {
  sessionId: string;
  idx: number;
  goal: number;
  cardsJson: string;
  issuedAt: number;
  status: string;
  finalExpr: string | null;
} | null {
  const row = getSqliteDb()
    .prepare(
      `SELECT sessionId, idx, goal, cardsJson, issuedAt, status, finalExpr
       FROM sprint_puzzles WHERE sessionId = ? AND idx = ?`
    )
    .get(sessionId, idx) as
    | {
        sessionId: string;
        idx: number;
        goal: number;
        cardsJson: string;
        issuedAt: number;
        status: string;
        finalExpr: string | null;
      }
    | undefined;
  return row ?? null;
}

function sqliteUpdateSprintPuzzleStatus(params: {
  sessionId: string;
  idx: number;
  status: "solved" | "skipped";
  finalExpr: string | null;
}): void {
  getSqliteDb()
    .prepare(`UPDATE sprint_puzzles SET status = ?, finalExpr = ? WHERE sessionId = ? AND idx = ?`)
    .run(params.status, params.finalExpr, params.sessionId, params.idx);
}

function sqliteGetSprintMaxIdx(sessionId: string): number {
  const row = getSqliteDb()
    .prepare(`SELECT COALESCE(MAX(idx), 0) AS maxIdx FROM sprint_puzzles WHERE sessionId = ?`)
    .get(sessionId) as { maxIdx: number } | undefined;
  return row?.maxIdx ?? 0;
}
