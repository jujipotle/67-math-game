import type { DataTarget } from "./dataSource";

const isDev = process.env.NODE_ENV === "development";

/**
 * Routes an "/api/..." path to the selected data source.
 *
 * - Production build: always same-origin (the deployed app has one database).
 * - Dev: everything goes through the dev-only proxy at /api/dev-proxy/*, which
 *   forwards to either this local server or the live production API based on
 *   `target`. This keeps every request (game, leaderboard, admin) routed by the
 *   single home-screen toggle, and keeps the admin key server-side.
 */
export function buildApiUrl(path: string, target: DataTarget): string {
  if (!isDev) return path;
  const [rawPath, rawQuery] = path.split("?");
  const suffix = rawPath.replace(/^\/api/, "");
  const params = new URLSearchParams(rawQuery);
  params.set("target", target);
  return `/api/dev-proxy${suffix}?${params.toString()}`;
}
