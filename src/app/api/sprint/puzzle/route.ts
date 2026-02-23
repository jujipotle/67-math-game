import { NextResponse } from "next/server";
import {
  getSprintMaxIdx,
  getSprintPuzzle,
  getSprintSession,
  upsertSprintPuzzle,
} from "@/lib/db";
import { generatePuzzle } from "@/lib/generator";
import { hasSolution } from "@/lib/solver";

export const runtime = "nodejs";

function generateSolvablePuzzle() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const p = generatePuzzle();
    if (hasSolution(p.cards, p.goal)) return p;
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { sessionId?: string } | null;
  const sessionId = body?.sessionId;
  if (!sessionId) return NextResponse.json({ error: "missing sessionId" }, { status: 400 });

  const session = await getSprintSession(sessionId);
  if (!session) return NextResponse.json({ error: "invalid session" }, { status: 404 });

  const now = Date.now();
  if (now > session.endsAt) {
    return NextResponse.json({ error: "session ended", endsAt: session.endsAt }, { status: 410 });
  }

  const maxIdx = await getSprintMaxIdx(sessionId);
  if (maxIdx > 0) {
    const current = await getSprintPuzzle(sessionId, maxIdx);
    if (current && current.status === "issued") {
      return NextResponse.json({
        idx: current.idx,
        endsAt: session.endsAt,
        puzzle: {
          goal: current.goal,
          cards: JSON.parse(current.cardsJson) as number[],
          n: (JSON.parse(current.cardsJson) as number[]).length,
        },
      });
    }
  }

  const idx = maxIdx + 1;
  const puzzle = generateSolvablePuzzle();
  await upsertSprintPuzzle({
    sessionId,
    idx,
    goal: puzzle.goal,
    cardsJson: JSON.stringify(puzzle.cards),
    issuedAt: now,
  });

  return NextResponse.json({
    idx,
    endsAt: session.endsAt,
    puzzle,
  });
}

