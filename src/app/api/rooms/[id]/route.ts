import { NextResponse } from "next/server";
import {
  adminDeleteRoom,
  endRound,
  getRoomSnapshot,
  kickPlayer,
  leaveRoom,
  setRoundDuration,
  startRound,
  submitSolve,
} from "@/lib/roomServer";

export const runtime = "nodejs";
export const maxDuration = 15;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const playerId = url.searchParams.get("playerId") ?? "";
  if (!playerId) {
    return NextResponse.json({ error: "missing playerId" }, { status: 400 });
  }
  const since = url.searchParams.get("since") ?? "";
  const waitRaw = Number(url.searchParams.get("waitMs") ?? 0);
  const waitMs = Number.isFinite(waitRaw) ? waitRaw : 0;
  const result = await getRoomSnapshot(id, playerId, {
    since,
    waitMs,
    signal: req.signal,
  });
  if ("error" in result) {
    return NextResponse.json(
      {
        error: result.error,
        ...(result.roomName ? { roomName: result.roomName } : {}),
        ...(result.kickedBy ? { kickedBy: result.kickedBy } : {}),
      },
      { status: result.status }
    );
  }
  return NextResponse.json(
    { room: result },
    { headers: { "Cache-Control": "no-store" } }
  );
}

type ActionBody = {
  action?: string;
  playerId?: string;
  newHostId?: string;
  targetId?: string;
  idx?: number;
  finalExpr?: string;
  durationMs?: number;
};

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as ActionBody | null;
  const action = body?.action;
  const playerId = body?.playerId ?? "";
  if (!action || !playerId) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  if (action === "leave") {
    const result = await leaveRoom({
      roomId: id,
      playerId,
      newHostId: body?.newHostId,
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  }

  if (action === "duration") {
    const result = await setRoundDuration({
      roomId: id,
      playerId,
      durationMs: body?.durationMs ?? 0,
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  }

  if (action === "start") {
    const result = await startRound({
      roomId: id,
      playerId,
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  }

  if (action === "end") {
    const result = await endRound({ roomId: id, playerId });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  }

  if (action === "solve") {
    const result = await submitSolve({
      roomId: id,
      playerId,
      idx: body?.idx ?? 0,
      finalExpr: body?.finalExpr ?? "",
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  }

  if (action === "kick") {
    const result = await kickPlayer({
      roomId: id,
      playerId,
      targetId: body?.targetId ?? "",
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  }

  if (action === "heartbeat") {
    const result = await getRoomSnapshot(id, playerId);
    if ("error" in result) {
      return NextResponse.json(
        {
          error: result.error,
          ...(result.roomName ? { roomName: result.roomName } : {}),
          ...(result.kickedBy ? { kickedBy: result.kickedBy } : {}),
        },
        { status: result.status }
      );
    }
    return NextResponse.json({ room: result });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const adminKey = process.env.LEADERBOARD_ADMIN_KEY;
  if (!adminKey) {
    return NextResponse.json({ error: "admin not configured" }, { status: 501 });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { adminKey?: string } | null;
  if (!body || body.adminKey !== adminKey) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const ok = await adminDeleteRoom(id);
  if (!ok) return NextResponse.json({ error: "room not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
