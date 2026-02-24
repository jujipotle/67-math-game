export type Rational = { n: bigint; d: bigint };

export type Op = "+" | "-" | "*" | "/";

export type Tile = {
  id: string;
  value: Rational;
  expr: string;
  alive: boolean;
};

export type Puzzle = {
  goal: number;
  cards: number[];
  n: number;
};

export type BoardState = {
  tiles: Tile[];
};

export type Step = {
  aExpr: string;
  bExpr: string;
  op: Op;
  resultExpr: string;
  resultValue: Rational;
};

export type SolvedRecord = {
  puzzle: Puzzle;
  userSteps: Step[];
  userFinalExpr: string;
  solutions: string[];
  solvedAtMs: number;
  sessionIndex: number;
  solutionsPending?: boolean;
};

export type SkippedRecord = {
  puzzle: Puzzle;
  solutions: string[];
  sessionIndex: number;
  solutionsPending?: boolean;
};

export type Mode = "practice" | "sprint";
export type Screen = "home" | "play" | "review" | "summary" | "leaderboard";

export type SessionState = {
  mode: Mode;
  screen: Screen;
  solvedCount: number;
  solved: SolvedRecord[];
  currentPuzzle: Puzzle | null;
  currentBoard: BoardState | null;
  historyStack: BoardState[];
  stepStack: Step[];
  playElapsedMs: number;
  sprintRemainingMs: number;
  timerRunning: boolean;
};

export type SavedSession = {
  mode: Mode;
  solved: SolvedRecord[];
  totalTimeMs: number;
  date: string;
};
