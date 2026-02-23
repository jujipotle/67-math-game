import { NextResponse } from "next/server";
import {
  getSprintPuzzle,
  getSprintSession,
  updateSprintEndsAt,
  updateSprintPuzzleStatus,
  updateSprintSolved,
} from "@/lib/db";
import { validateFinalExpr } from "@/lib/solver";

export const runtime = "nodejs";

const SKIP_PENALTY_MS = 20_000;

type MarkBody = {
  sessionId?: string;
  idx?: number;
  outcome?: "solved" | "skipped";
  finalExpr?: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as MarkBody | null;
  const sessionId = body?.sessionId;
  const idx = body?.idx;
  const outcome = body?.outcome;

  if (!sessionId || !idx || !outcome) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const session = await getSprintSession(sessionId);
  if (!session) return NextResponse.json({ error: "invalid session" }, { status: 404 });

  const now = Date.now();
  if (now > session.endsAt) {
    return NextResponse.json({ error: "session ended", endsAt: session.endsAt }, { status: 410 });
  }

  const puzzleRow = await getSprintPuzzle(sessionId, idx);
  if (!puzzleRow) return NextResponse.json({ error: "invalid puzzle" }, { status: 404 });
  if (puzzleRow.status !== "issued") {
    return NextResponse.json({ ok: true, endsAt: session.endsAt });
  }

  const cards = JSON.parse(puzzleRow.cardsJson) as number[];
  const goal = puzzleRow.goal;

  if (outcome === "solved") {
    const finalExpr = (body?.finalExpr ?? "").trim();
    if (!finalExpr) return NextResponse.json({ error: "missing finalExpr" }, { status: 400 });
    if (!validateFinalExpr(finalExpr, cards, goal)) {
      return NextResponse.json({ error: "invalid solution" }, { status: 400 });
    }
    await updateSprintPuzzleStatus({ sessionId, idx, status: "solved", finalExpr });
    await updateSprintSolved(sessionId, 1);
    return NextResponse.json({ ok: true, endsAt: session.endsAt });
  }

  // skipped
  await updateSprintPuzzleStatus({ sessionId, idx, status: "skipped", finalExpr: null });
  const nextEndsAt = Math.max(now, session.endsAt - SKIP_PENALTY_MS);
  await updateSprintEndsAt(sessionId, nextEndsAt);
  return NextResponse.json({ ok: true, endsAt: nextEndsAt });
}

