export const MIN_ROUND_MINUTES = 1;
export const MAX_ROUND_MINUTES = 10;
export const DEFAULT_ROUND_MINUTES = 5;
export const MIN_ROUND_MS = MIN_ROUND_MINUTES * 60 * 1000;
export const MAX_ROUND_MS = MAX_ROUND_MINUTES * 60 * 1000;
export const DEFAULT_ROUND_MS = DEFAULT_ROUND_MINUTES * 60 * 1000;

export function minutesToRoundMs(minutes: number): number {
  return minutes * 60 * 1000;
}

/** Snap stored ms to a whole minute in 1–10. */
export function roundMsToMinutes(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_ROUND_MINUTES;
  const m = Math.round(ms / 60_000);
  return Math.min(MAX_ROUND_MINUTES, Math.max(MIN_ROUND_MINUTES, m));
}

export function clampRoundMinutes(minutes: number): number {
  if (!Number.isInteger(minutes)) return DEFAULT_ROUND_MINUTES;
  return Math.min(MAX_ROUND_MINUTES, Math.max(MIN_ROUND_MINUTES, minutes));
}

export function isValidRoundDurationMs(ms: number): boolean {
  return (
    Number.isInteger(ms) &&
    ms >= MIN_ROUND_MS &&
    ms <= MAX_ROUND_MS &&
    ms % 60_000 === 0
  );
}
