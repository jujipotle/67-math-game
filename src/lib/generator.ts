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

export function generatePuzzle(): Puzzle {
  const goal = Math.floor(Math.random() * 200) + 1;
  const n = cardCount(goal);
  const MAX_CARD_ATTEMPTS = 500;

  for (let attempt = 0; attempt < MAX_CARD_ATTEMPTS; attempt++) {
    const shuffled = shuffle(DECK);
    const cards = shuffled.slice(0, n);

    if (hasSolution(cards, goal)) {
      return { goal, cards, n };
    }
  }

  return { goal: 24, cards: [1, 2, 3, 4], n: 4 };
}
