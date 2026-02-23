/**
 * Blocklist for leaderboard names. Terms are read from the environment so
 * no offensive words are stored in the repo.
 *
 * Set LEADERBOARD_BLOCKED_TERMS to a comma- or newline-separated list of
 * lowercase terms (e.g. in Vercel: Project → Settings → Environment Variables).
 * Matching is case-insensitive and normalizes common number/letter substitutions
 * (0→o, 1→i, 4→a, @→a, etc.).
 *
 * If unset, no blocking is applied (suitable for local dev; for production
 * you should set this).
 */

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/@/g, "a")
    .replace(/!/g, "i")
    .replace(/\$/g, "s");
}

function getBlockedTerms(): string[] {
  const raw = process.env.LEADERBOARD_BLOCKED_TERMS ?? "";
  return raw
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns true if the text contains any blocklist term (after normalization).
 */
export function containsBlockedTerm(text: string): boolean {
  const terms = getBlockedTerms();
  if (terms.length === 0) return false;
  const normalized = normalizeForMatch(text);
  return terms.some((term) => normalized.includes(term));
}
