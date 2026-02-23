import { NextResponse } from "next/server";
import { createSprintSession, getSprintMaxIdx, upsertSprintPuzzle } from "@/lib/db";
import { generatePuzzle } from "@/lib/generator";
import { hasSolution } from "@/lib/solver";

export const runtime = "nodejs";

const SPRINT_DURATION_MS = 5 * 60 * 1000;

function generateSolvablePuzzle() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const p = generatePuzzle();
    if (hasSolution(p.cards, p.goal)) return p;
  }
}

export async function POST() {
  const now = Date.now();
  const session = await createSprintSession(now, SPRINT_DURATION_MS);

  const maxIdx = await getSprintMaxIdx(session.id);
  const idx = maxIdx + 1;
  const puzzle = generateSolvablePuzzle();
  await upsertSprintPuzzle({
    sessionId: session.id,
    idx,
    goal: puzzle.goal,
    cardsJson: JSON.stringify(puzzle.cards),
    issuedAt: now,
  });

  return NextResponse.json({
    sessionId: session.id,
    endsAt: session.endsAt,
    puzzle: { ...puzzle, n: puzzle.n },
    idx,
  });
}

