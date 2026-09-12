import { NextResponse } from "next/server";
import { getSprintMaxIdx, getSprintPuzzle, getSprintSession } from "@/lib/db";
import { issueSprintPuzzle } from "@/lib/sprintServer";

export const runtime = "nodejs";

type Body = { sessionId?: string };

/**
 * Issues the next sprint puzzle for a session. The server is the puzzle
 * authority: it picks the band, generates the puzzle, persists it, and returns
 * it. The client cannot influence the goal or cards.
 *
 * The band is tracked on the session and advances only when a puzzle is solved
 * (see /api/sprint/mark). This endpoint simply generates for the current band.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const sessionId = body?.sessionId;

  if (!sessionId) {
    return NextResponse.json({ error: "missing sessionId" }, { status: 400 });
  }

  const session = await getSprintSession(sessionId);
  if (!session) return NextResponse.json({ error: "invalid session" }, { status: 404 });
  if (session.submitted) {
    return NextResponse.json({ error: "already submitted" }, { status: 409 });
  }

  const remainingMs = session.endsAt - session.startedAt;
  // Allow a 30s grace buffer for network latency variance so a client that still has
  // time on its local timer is never abruptly rejected with 410.
  if (remainingMs < -30_000) {
    return NextResponse.json(
      { error: "session ended", endsAt: session.endsAt },
      { status: 410 }
    );
  }

  const maxIdx = await getSprintMaxIdx(sessionId);
  if (maxIdx >= 1) {
    const latest = await getSprintPuzzle(sessionId, maxIdx);
    if (latest && latest.status === "issued") {
      const cards = JSON.parse(latest.cardsJson) as number[];
      return NextResponse.json({
        idx: maxIdx,
        goal: latest.goal,
        cards,
        endsAt: session.endsAt,
      });
    }
  }

  const idx = maxIdx + 1;
  const puzzle = await issueSprintPuzzle(sessionId, idx, session.band);

  return NextResponse.json({
    idx,
    goal: puzzle.goal,
    cards: puzzle.cards,
    endsAt: session.endsAt,
  });
}
