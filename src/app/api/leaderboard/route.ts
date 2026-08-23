import { NextResponse } from "next/server";
import { containsBlockedTerm } from "@/lib/blocklist";
import {
  deleteLeaderboardEntries,
  findLeaderboardEntriesByName,
  getSprintSession,
  insertLeaderboardEntry,
  listLeaderboardEntries,
  markSprintSubmitted,
  replaceLeaderboardScore,
  updateLeaderboardEntry,
  LeaderboardKind,
} from "@/lib/db";
import { sanitizeName } from "@/lib/sanitize";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kindParam = url.searchParams.get("kind");
  const kind: LeaderboardKind = kindParam === "old" ? "old" : "new";
  // Top 50 distinct score tiers, including everyone tied at a qualifying score.
  const entries = await listLeaderboardEntries(50, kind);
  return NextResponse.json({ entries, kind });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    sessionId?: string;
    name?: string;
    replace?: boolean;
    confirmAdd?: boolean;
  } | null;
  const sessionId = body?.sessionId;
  const nameRaw = body?.name ?? "";
  const name = sanitizeName(nameRaw);
  const replace = body?.replace === true;
  const confirmAdd = body?.confirmAdd === true;

  if (!sessionId || !name) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (replace && confirmAdd) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const session = await getSprintSession(sessionId);
  if (!session) return NextResponse.json({ error: "invalid session" }, { status: 404 });
  if (session.submitted) return NextResponse.json({ error: "already submitted" }, { status: 409 });

  if (containsBlockedTerm(name)) {
    return NextResponse.json({ error: "name not allowed" }, { status: 400 });
  }

  const kind: LeaderboardKind = "new";
  const score = session.solved;
  const existing = await findLeaderboardEntriesByName(name, kind);
  const best = existing[0] ?? null;

  if (best) {
    if (score > best.score) {
      if (!replace) {
        return NextResponse.json(
          {
            error: "name exists",
            conflict: "replaceable",
            existingScore: best.score,
            score,
            lowerCount: existing.length,
          },
          { status: 409 }
        );
      }
      const ok = await replaceLeaderboardScore({
        keepId: best.id,
        name,
        score,
        createdAt: Date.now(),
        kind,
      });
      if (!ok) {
        return NextResponse.json(
          { error: "cannot replace with a lower score" },
          { status: 409 }
        );
      }
      await markSprintSubmitted(sessionId);
      return NextResponse.json({ ok: true, id: best.id, score, replaced: true });
    }

    // Not a new personal best — offer to add without touching existing entries.
    if (!confirmAdd) {
      return NextResponse.json(
        {
          error: "name exists",
          conflict: "add",
          existingScore: best.score,
          score,
        },
        { status: 409 }
      );
    }
  }

  const id = await insertLeaderboardEntry(name, score, Date.now(), kind);
  await markSprintSubmitted(sessionId);

  return NextResponse.json({ ok: true, id, score });
}

/**
 * DELETE: Remove leaderboard entries (admin only).
 * Body: { adminKey: string, id: number } or { adminKey: string, ids: number[] }
 */
export async function DELETE(req: Request) {
  const adminKey = process.env.LEADERBOARD_ADMIN_KEY;
  if (!adminKey) {
    return NextResponse.json(
      { error: "leaderboard delete not configured" },
      { status: 501 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    adminKey?: string;
    id?: number;
    ids?: number[];
  } | null;
  const key = body?.adminKey;
  if (key !== adminKey) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ids = Array.isArray(body?.ids)
    ? body.ids
    : typeof body?.id === "number"
      ? [body.id]
      : [];
  const valid = ids.filter((id) => Number.isInteger(id) && id > 0);
  if (valid.length === 0) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const deleted = await deleteLeaderboardEntries(valid);
  if (deleted === 0) {
    return NextResponse.json({ error: "entry not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, deleted });
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

