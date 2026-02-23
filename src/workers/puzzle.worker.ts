import { generatePuzzle } from "../lib/generator";
import { solve, hasSolution } from "../lib/solver";
import type { Puzzle } from "../lib/types";

type PreGenerateMessage = { type: "preGenerate" };
type SolveAllMessage = {
  type: "solveAll";
  id: number;
  cards: number[];
  goal: number;
};

type IncomingMessage = PreGenerateMessage | SolveAllMessage;

self.onmessage = (e: MessageEvent<IncomingMessage>) => {
  const data = e.data;

  if (data.type === "preGenerate") {
    // Find the next puzzle that has at least one valid solution.
    // This runs entirely in the worker so it won't block the UI.
    // We only return the puzzle; full solution enumeration happens separately.
    // In practice generatePuzzle always produces something solvable within a few tries.
    // Still, we loop until we find one with a solution.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const p: Puzzle = generatePuzzle();
      if (hasSolution(p.cards, p.goal)) {
        self.postMessage({ kind: "puzzle", puzzle: p });
        return;
      }
    }
  }

  if (data.type === "solveAll") {
    const solutions = solve(data.cards, data.goal);
    self.postMessage({ kind: "solutions", id: data.id, solutions });
  }
};
