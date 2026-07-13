import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Dev-only API proxy.
 *
 * Forwards any /api/dev-proxy/<path>?target=local|production request to either
 * this local dev server or the live production API. This lets a single toggle
 * on the home screen route ALL behavior (playing the game, leaderboard, admin)
 * at either database.
 *
 * The admin key is injected here (server-side) for leaderboard DELETE/PATCH, so
 * it is never exposed to the browser. Returns 404 outside development, so it
 * adds no attack surface to the deployed site.
 */

const PROD_BASE = "https://67-math-game.vercel.app";

function devOnly(): NextResponse | null {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return null;
}

async function handle(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const blocked = devOnly();
  if (blocked) return blocked;

  const { path } = await ctx.params;
  const route = path.join("/");
  const url = new URL(req.url);

  const target = url.searchParams.get("target") === "production" ? "production" : "local";
  const base = target === "production" ? PROD_BASE : url.origin;

  const forwardParams = new URLSearchParams(url.search);
  forwardParams.delete("target");
  const qs = forwardParams.toString();
  const downstream = `${base}/api/${route}${qs ? `?${qs}` : ""}`;

  const method = req.method;
  const headers: Record<string, string> = {};
  let body: string | undefined;

  if (method !== "GET" && method !== "HEAD") {
    const raw = await req.json().catch(() => null);
    const payload: Record<string, unknown> =
      raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};

    // Inject the admin key for privileged leaderboard ops (never sent by client).
    if (route === "leaderboard" && (method === "DELETE" || method === "PATCH")) {
      const adminKey = process.env.LEADERBOARD_ADMIN_KEY;
      if (!adminKey) {
        return NextResponse.json(
          { error: "LEADERBOARD_ADMIN_KEY is not set in your .env" },
          { status: 501 }
        );
      }
      payload.adminKey = adminKey;
    }

    body = JSON.stringify(payload);
    headers["Content-Type"] = "application/json";
  }

  try {
    const res = await fetch(downstream, { method, headers, body, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: `Failed to reach ${base}` }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const PATCH = handle;
