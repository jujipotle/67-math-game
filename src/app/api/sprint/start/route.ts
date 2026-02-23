import { NextResponse } from "next/server";
import { createSprintSession } from "@/lib/db";

export const runtime = "nodejs";

const SPRINT_DURATION_MS = 5 * 60 * 1000;

/** Creates a sprint session only. Client generates and registers puzzles locally. */
export async function POST() {
  const now = Date.now();
  const session = await createSprintSession(now, SPRINT_DURATION_MS);
  return NextResponse.json({
    sessionId: session.id,
    endsAt: session.endsAt,
  });
}
