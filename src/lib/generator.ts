import { Puzzle } from "./types";
import { hasSolution } from "./solver";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function cardCount(goal: number): number {
  if (goal < 67) return 4;
  if (goal < 134) return 5;
  return 6;
}

const DECK: number[] = [];
for (let rank = 1; rank <= 13; rank++) {
  for (let suit = 0; suit < 4; suit++) {
    DECK.push(rank);
  }
}

const MAX_SHUFFLE_ATTEMPTS_PER_GOAL = 500;
const FALLBACK: Puzzle = { goal: 24, cards: [1, 2, 3, 4], n: 4 };

/**
 * Pick a random goal (1–200), then keep drawing card sets until one is solvable.
 * If no solvable set is found after many shuffles for that goal, pick a new goal and retry.
 */
export function generatePuzzle(): Puzzle {
  for (let goalAttempt = 0; goalAttempt < 10; goalAttempt++) {
    const goal = Math.floor(Math.random() * 200) + 1;
    const n = cardCount(goal);

    for (let shuffleAttempt = 0; shuffleAttempt < MAX_SHUFFLE_ATTEMPTS_PER_GOAL; shuffleAttempt++) {
      const shuffled = shuffle(DECK);
      const cards = shuffled.slice(0, n);

      if (hasSolution(cards, goal)) {
        return { goal, cards, n };
      }
    }
  }

  return FALLBACK;
}

/**
 * Generate a puzzle whose target is constrained to a specific band for sprint mode.
 * Band 0: 1–66  (4 cards)
 * Band 1: 67–133 (5 cards)
 * Band 2: 134–200 (6 cards)
 */
export function generateSprintPuzzle(band: 0 | 1 | 2): Puzzle {
  const bands: [number, number][] = [
    [1, 66],
    [67, 133],
    [134, 200],
  ];
  const [minGoal, maxGoal] = bands[band] ?? bands[0];

  for (let goalAttempt = 0; goalAttempt < 10; goalAttempt++) {
    const span = maxGoal - minGoal + 1;
    const goal = minGoal + Math.floor(Math.random() * span);
    const n = cardCount(goal);

    for (
      let shuffleAttempt = 0;
      shuffleAttempt < MAX_SHUFFLE_ATTEMPTS_PER_GOAL;
      shuffleAttempt++
    ) {
      const shuffled = shuffle(DECK);
      const cards = shuffled.slice(0, n);

      if (hasSolution(cards, goal)) {
        return { goal, cards, n };
      }
    }
  }

  return FALLBACK;
}
