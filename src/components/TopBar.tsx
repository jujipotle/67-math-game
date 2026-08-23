"use client";

type Standing = {
  name: string;
  score: number;
  isYou?: boolean;
};

type TopBarProps = {
  solvedCount: number;
  timerDisplay: string;
  onQuit: () => void;
  showShortcuts?: boolean;
  quitLabel?: string;
  leaderNote?: string | null;
  standings?: Standing[] | null;
  notice?: string | null;
};

export default function TopBar({
  solvedCount,
  timerDisplay,
  onQuit,
  showShortcuts,
  quitLabel = "Quit",
  leaderNote,
  standings,
  notice,
}: TopBarProps) {
  return (
    <div
      className="w-full max-w-sm mx-auto border-b border-neutral-200"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}
    >
      <div className="flex items-center justify-between px-4 pb-2">
        <span className="text-base font-medium text-neutral-600 min-w-[4.5rem]">
          Solved: {solvedCount}
        </span>
        <span className="text-xl font-mono font-semibold tabular-nums">
          {timerDisplay}
        </span>
        <button
          type="button"
          onClick={onQuit}
          className="min-w-[3.25rem] h-7 px-2.5 rounded-md border border-neutral-300 bg-white text-sm font-medium leading-none text-neutral-700 active:bg-neutral-50 transition-colors"
        >
          {quitLabel}
        </button>
      </div>
      {leaderNote ? (
        <div className="px-4 pb-1.5 text-center text-xs text-neutral-500">
          {leaderNote}
        </div>
      ) : null}
      {standings && standings.length > 0 ? (
        <div className="px-4 pb-2 text-xs text-neutral-600">
          {standings.map((s) => (
            <div
              key={s.name}
              className={`flex justify-between tabular-nums ${
                s.isYou ? "font-semibold text-neutral-900" : ""
              }`}
            >
              <span>
                {s.name}
                {s.isYou ? " (you)" : ""}
              </span>
              <span>{s.score}</span>
            </div>
          ))}
        </div>
      ) : null}
      {notice ? (
        <div className="px-4 pb-2 text-center text-xs text-neutral-700">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
