import { NextResponse } from "next/server";
import { createRoom, listRoomSummaries } from "@/lib/roomServer";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rooms = await listRoomSummaries();
    return NextResponse.json(
      { rooms },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "failed to list rooms";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      playerName?: string;
      roomName?: string;
      isPrivate?: boolean;
      password?: string;
    } | null;

    const playerName = body?.playerName ?? "";
    const result = await createRoom({
      playerName,
      roomName: body?.roomName,
      isPrivate: !!body?.isPrivate,
      password: body?.password,
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "failed to create room";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
