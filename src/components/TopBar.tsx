"use client";

type TopBarProps = {
  solvedCount: number;
  timerDisplay: string;
  onQuit: () => void;
};

export default function TopBar({ solvedCount, timerDisplay, onQuit }: TopBarProps) {
  return (
    <div
      className="flex items-center justify-between px-4 border-b border-neutral-200"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}
    >
      <span className="text-sm font-medium text-neutral-600 min-w-[4.5rem]">
        Solved: {solvedCount}
      </span>
      <span className="text-lg font-mono font-semibold tabular-nums">
        {timerDisplay}
      </span>
      <button
        onClick={onQuit}
        className="min-w-[2.75rem] min-h-[2.75rem] flex items-center justify-center text-sm font-medium text-neutral-500 hover:text-neutral-900 active:text-neutral-900 transition-colors"
      >
        Quit
      </button>
    </div>
  );
}
