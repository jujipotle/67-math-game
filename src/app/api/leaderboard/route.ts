import { NextResponse } from "next/server";
import { containsBlockedTerm } from "@/lib/blocklist";
import {
  deleteLeaderboardEntry,
  getSprintSession,
  insertLeaderboardEntry,
  listLeaderboardEntries,
  markSprintSubmitted,
  updateLeaderboardEntry,
  LeaderboardKind,
} from "@/lib/db";

export const runtime = "nodejs";

function sanitizeName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 1 || name.length > 20) return null;
  if (!/^[a-zA-Z0-9 _-]+$/.test(name)) return null;
  return name;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kindParam = url.searchParams.get("kind");
  const kind: LeaderboardKind = kindParam === "old" ? "old" : "new";
  const entries = await listLeaderboardEntries(50, kind);
  return NextResponse.json({ entries, kind });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { sessionId?: string; name?: string } | null;
  const sessionId = body?.sessionId;
  const nameRaw = body?.name ?? "";
  const name = sanitizeName(nameRaw);

  if (!sessionId || !name) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const session = await getSprintSession(sessionId);
  if (!session) return NextResponse.json({ error: "invalid session" }, { status: 404 });
  if (session.submitted) return NextResponse.json({ error: "already submitted" }, { status: 409 });

  if (containsBlockedTerm(name)) {
    return NextResponse.json({ error: "name not allowed" }, { status: 400 });
  }

  // New submissions always go to the "new" balanced sprint leaderboard.
  const id = await insertLeaderboardEntry(name, session.solved, Date.now(), "new");
  await markSprintSubmitted(sessionId);

  return NextResponse.json({ ok: true, id, score: session.solved });
}

/**
 * DELETE: Remove a leaderboard entry (admin only).
 * Body: { adminKey: string, id: number }
 * Set LEADERBOARD_ADMIN_KEY in .env to enable. If unset, DELETE returns 501.
 */
export async function DELETE(req: Request) {
  const adminKey = process.env.LEADERBOARD_ADMIN_KEY;
  if (!adminKey) {
    return NextResponse.json(
      { error: "leaderboard delete not configured" },
      { status: 501 }
    );
  }

  const body = (await req.json().catch(() => null)) as { adminKey?: string; id?: number } | null;
  const key = body?.adminKey;
  const id = typeof body?.id === "number" ? body.id : NaN;

  if (key !== adminKey || !Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const deleted = await deleteLeaderboardEntry(id);
  if (!deleted) {
    return NextResponse.json({ error: "entry not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * PATCH: Edit a leaderboard entry (admin only).
 * Body: { adminKey: string, id: number, name: string, score: number, kind: "old" | "new" }
 */
export async function PATCH(req: Request) {
  const adminKey = process.env.LEADERBOARD_ADMIN_KEY;
  if (!adminKey) {
    return NextResponse.json(
      { error: "leaderboard edit not configured" },
      { status: 501 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    adminKey?: string;
    id?: number;
    name?: string;
    score?: number;
    kind?: LeaderboardKind;
  } | null;

  if (!body || body.adminKey !== adminKey) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = typeof body.id === "number" ? body.id : NaN;
  const nameRaw = body.name ?? "";
  const name = sanitizeName(nameRaw);
  const score = typeof body.score === "number" ? body.score : NaN;
  const kind = body.kind === "old" || body.kind === "new" ? body.kind : undefined;

  if (!Number.isInteger(id) || id < 1 || !name || !Number.isInteger(score) || !kind) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  if (containsBlockedTerm(name)) {
    return NextResponse.json({ error: "name not allowed" }, { status: 400 });
  }

  const updated = await updateLeaderboardEntry({ id, name, score, kind });
  if (!updated) {
    return NextResponse.json({ error: "entry not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

