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

export type Mode = "practice" | "sprint" | "multiplayer";
export type Screen =
  | "home"
  | "play"
  | "review"
  | "summary"
  | "leaderboard"
  | "mp-hub"
  | "mp-lobby"
  | "mp-wait"
  | "mp-results";

export type RoomStatus = "lobby" | "playing" | "results";
export type RoomPlayerRole = "active" | "waiting";

export type RoomListItem = {
  id: string;
  name: string;
  hostName: string;
  isPrivate: boolean;
  status: RoomStatus;
  playerCount: number;
  playerNames: string[];
};

export type RoomPlayerView = {
  id: string;
  name: string;
  isHost: boolean;
  role: RoomPlayerRole;
  score: number;
  scoreReachedAt: number | null;
  participated: boolean;
};

export type RoomPuzzleView = {
  idx: number;
  goal: number;
  cards: number[];
};

export type RoomLeaderView = {
  name: string;
  score: number;
  isYou: boolean;
} | null;

export type RoomStateView = {
  id: string;
  name: string;
  status: RoomStatus;
  isPrivate: boolean;
  hostId: string;
  hostName: string;
  round: number;
  roundStartedAt: number | null;
  roundEndsAt: number | null;
  roundDurationMs: number;
  you: {
    playerId: string;
    name: string;
    isHost: boolean;
    role: RoomPlayerRole;
    score: number;
    puzzleIdx: number;
    participated: boolean;
  };
  players: RoomPlayerView[];
  leader: RoomLeaderView;
  puzzles: RoomPuzzleView[];
  /** Opaque cursor for long-poll; pass back as `since` on the next GET. */
  sync: string;
};


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
