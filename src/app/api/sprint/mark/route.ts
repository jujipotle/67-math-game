import { NextResponse } from "next/server";
import {
  getSprintPuzzle,
  getSprintSession,
  updateSprintBand,
  updateSprintEndsAt,
  updateSprintPuzzleStatus,
  updateSprintSolved,
} from "@/lib/db";
import { validateFinalExpr } from "@/lib/solver";
import { issueSprintPuzzle, nextBand } from "@/lib/sprintServer";

export const runtime = "nodejs";

const SKIP_PENALTY_MS = 20_000;

type MarkBody = {
  sessionId?: string;
  idx?: number;
  outcome?: "solved" | "skipped";
  finalExpr?: string;
  timeOnPuzzleMs?: number;
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
  const puzzleRow = await getSprintPuzzle(sessionId, idx);
  if (!puzzleRow) return NextResponse.json({ error: "invalid puzzle" }, { status: 404 });
  if (puzzleRow.status !== "issued") {
    return NextResponse.json({ ok: true, endsAt: session.endsAt });
  }

  const cards = JSON.parse(puzzleRow.cardsJson) as number[];
  const goal = puzzleRow.goal;
  const remainingBeforeMs = session.endsAt - session.startedAt;
  const issuedAt = Number(puzzleRow.issuedAt);
  const serverElapsedMs = Math.max(0, now - issuedAt);

  // Client tracks active play time on the puzzle (excluding network transit).
  // Cap at serverElapsedMs to prevent cheating by passing negative/deflated values.
  const rawClientTime = typeof body?.timeOnPuzzleMs === "number" ? body.timeOnPuzzleMs : null;
  const timeOnPuzzleMs =
    rawClientTime != null && rawClientTime >= 0
      ? Math.min(serverElapsedMs, Math.max(0, Math.round(rawClientTime)))
      : serverElapsedMs;

  // Allow 30s grace for network latency variance so late solves are not abruptly dropped.
  const sessionEnded = remainingBeforeMs < -30_000;

  if (outcome === "solved") {
    if (sessionEnded) {
      return NextResponse.json({ error: "session ended", endsAt: session.endsAt }, { status: 410 });
    }
    const finalExpr = (body?.finalExpr ?? "").trim();
    if (!finalExpr) return NextResponse.json({ error: "missing finalExpr" }, { status: 400 });
    if (!validateFinalExpr(finalExpr, cards, goal)) {
      return NextResponse.json({ error: "invalid solution" }, { status: 400 });
    }
    await updateSprintPuzzleStatus({ sessionId, idx, status: "solved", finalExpr });
    await updateSprintSolved(sessionId, 1);
    // Server-authoritative band rotation: advance on solve, keep on skip.
    const newBand = nextBand(session.band);
    await updateSprintBand(sessionId, newBand);
    const remainingAfterMs = Math.max(0, remainingBeforeMs - timeOnPuzzleMs);
    const nextEndsAt = session.startedAt + remainingAfterMs;
    await updateSprintEndsAt(sessionId, nextEndsAt);

    let nextPuzzleData = null;
    if (remainingAfterMs > 0) {
      const nextIdx = idx + 1;
      const nextPuzzle = await issueSprintPuzzle(sessionId, nextIdx, newBand);
      nextPuzzleData = {
        idx: nextIdx,
        goal: nextPuzzle.goal,
        cards: nextPuzzle.cards,
        endsAt: nextEndsAt,
      };
    }

    return NextResponse.json({
      ok: true,
      endsAt: nextEndsAt,
      nextPuzzle: nextPuzzleData,
    });
  }

  // skipped
  if (sessionEnded) {
    return NextResponse.json({ error: "session ended", endsAt: session.endsAt }, { status: 410 });
  }
  await updateSprintPuzzleStatus({ sessionId, idx, status: "skipped", finalExpr: null });
  const remainingAfterMs = Math.max(0, remainingBeforeMs - timeOnPuzzleMs - SKIP_PENALTY_MS);
  const nextEndsAt = session.startedAt + remainingAfterMs;
  await updateSprintEndsAt(sessionId, nextEndsAt);

  let nextPuzzleData = null;
  if (remainingAfterMs > 0) {
    const nextIdx = idx + 1;
    const nextPuzzle = await issueSprintPuzzle(sessionId, nextIdx, session.band);
    nextPuzzleData = {
      idx: nextIdx,
      goal: nextPuzzle.goal,
      cards: nextPuzzle.cards,
      endsAt: nextEndsAt,
    };
  }

  return NextResponse.json({
    ok: true,
    endsAt: nextEndsAt,
    nextPuzzle: nextPuzzleData,
  });
}

