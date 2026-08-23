import { NextResponse } from "next/server";
import { listRoomSummariesAdmin } from "@/lib/roomServer";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const adminKey = process.env.LEADERBOARD_ADMIN_KEY;
  if (!adminKey) {
    return NextResponse.json({ error: "admin not configured" }, { status: 501 });
  }
  const url = new URL(req.url);
  const key = url.searchParams.get("adminKey") ?? "";
  if (key !== adminKey) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rooms = await listRoomSummariesAdmin();
  return NextResponse.json({ rooms });
}
