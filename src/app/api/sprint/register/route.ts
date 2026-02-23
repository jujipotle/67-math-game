import { NextResponse } from "next/server";
import { getSprintSession, upsertSprintPuzzle } from "@/lib/db";

export const runtime = "nodejs";

type Body = { sessionId?: string; idx?: number; goal?: number; cards?: number[] };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const sessionId = body?.sessionId;
  const idx = body?.idx;
  const goal = body?.goal;
  const cards = body?.cards;

  if (!sessionId || idx == null || goal == null || !Array.isArray(cards)) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const session = await getSprintSession(sessionId);
  if (!session) return NextResponse.json({ error: "invalid session" }, { status: 404 });
  if (Date.now() > session.endsAt) {
    return NextResponse.json({ error: "session ended", endsAt: session.endsAt }, { status: 410 });
  }

  await upsertSprintPuzzle({
    sessionId,
    idx,
    goal,
    cardsJson: JSON.stringify(cards),
    issuedAt: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
