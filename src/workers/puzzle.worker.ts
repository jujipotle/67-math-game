import { generatePuzzle } from "../lib/generator";
import { solve } from "../lib/solver";
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
    const p: Puzzle = generatePuzzle();
    self.postMessage({ kind: "puzzle", puzzle: p });
    return;
  }

  if (data.type === "solveAll") {
    const solutions = solve(data.cards, data.goal);
    self.postMessage({ kind: "solutions", id: data.id, solutions });
  }
};
