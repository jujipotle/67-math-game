import { NextResponse } from "next/server";
import { createSprintSession } from "@/lib/db";
import { issueSprintPuzzle } from "@/lib/sprintServer";

export const runtime = "nodejs";

const SPRINT_DURATION_MS = 5 * 60 * 1000;

/**
 * Creates a sprint session and issues the first puzzle server-side.
 * The client no longer generates or submits puzzles; the server is the
 * puzzle authority.
 */
export async function POST() {
  const now = Date.now();
  const session = await createSprintSession(now, SPRINT_DURATION_MS);

  // Puzzle #1 always uses band 0 (goals 1–66, 4 cards).
  const idx = 1;
  const puzzle = await issueSprintPuzzle(session.id, idx, session.band);

  return NextResponse.json({
    sessionId: session.id,
    endsAt: session.endsAt,
    idx,
    goal: puzzle.goal,
    cards: puzzle.cards,
  });
}
