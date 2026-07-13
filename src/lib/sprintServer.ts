import { Puzzle } from "./types";
import { generateSprintPuzzle } from "./generator";
import { getSprintPuzzle, upsertSprintPuzzle } from "./db";

/** Band rules: 0 → goals 1–66 (4 cards), 1 → 67–133 (5 cards), 2 → 134–200 (6 cards). */
export function normalizeBand(band: number): 0 | 1 | 2 {
  return band === 1 || band === 2 ? band : 0;
}

/** Advances the band on a solved puzzle. Skips keep the same band. */
export function nextBand(band: number): 0 | 1 | 2 {
  return ((normalizeBand(band) + 1) % 3) as 0 | 1 | 2;
}

/**
 * Server-authoritative puzzle issuance: generates a puzzle for the given band,
 * persists it as `issued`, and returns the puzzle that is actually stored.
 *
 * Reading the row back after the upsert guarantees the client receives exactly
 * what the server validates against, even if a row for (sessionId, idx) already
 * existed (Neon upsert is ON CONFLICT DO NOTHING).
 */
export async function issueSprintPuzzle(
  sessionId: string,
  idx: number,
  band: number
): Promise<Puzzle> {
  const generated = generateSprintPuzzle(normalizeBand(band));
  await upsertSprintPuzzle({
    sessionId,
    idx,
    goal: generated.goal,
    cardsJson: JSON.stringify(generated.cards),
    issuedAt: Date.now(),
  });

  const stored = await getSprintPuzzle(sessionId, idx);
  if (!stored) {
    // Should not happen, but fall back to the generated puzzle.
    return generated;
  }
  const cards = JSON.parse(stored.cardsJson) as number[];
  return { goal: stored.goal, cards, n: cards.length };
}
