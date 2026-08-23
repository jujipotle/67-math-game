import { NextResponse } from "next/server";
import { joinRoom } from "@/lib/roomServer";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    roomId?: string;
    roomName?: string;
    playerName?: string;
    password?: string;
  } | null;

  const result = await joinRoom({
    roomId: body?.roomId,
    roomName: body?.roomName,
    playerName: body?.playerName ?? "",
    password: body?.password,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
