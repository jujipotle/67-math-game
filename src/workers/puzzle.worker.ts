import { generatePuzzle } from "../lib/generator";
import { solve } from "../lib/solver";
import type { Puzzle } from "../lib/types";

self.onmessage = () => {
  const p = generatePuzzle();
  const solutions = solve(p.cards, p.goal);
  if (solutions.length > 0) {
    self.postMessage({ puzzle: p, solutions });
  }
};
