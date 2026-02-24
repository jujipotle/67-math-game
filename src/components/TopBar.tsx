"use client";

type TopBarProps = {
  solvedCount: number;
  timerDisplay: string;
  onQuit: () => void;
  showShortcuts?: boolean;
};

export default function TopBar({ solvedCount, timerDisplay, onQuit, showShortcuts }: TopBarProps) {
  return (
    <div
      className="w-full max-w-sm mx-auto flex items-center justify-between px-4 border-b border-neutral-200"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}
    >
      <span className="text-base font-medium text-neutral-600 min-w-[4.5rem]">
        Solved: {solvedCount}
      </span>
      <span className="text-xl font-mono font-semibold tabular-nums">
        {timerDisplay}
      </span>
      <button
        onClick={onQuit}
        className="min-w-[2.75rem] min-h-[2.75rem] flex items-center justify-center text-sm font-medium text-neutral-500 hover:text-neutral-900 active:text-neutral-900 transition-colors"
      >
        <div className="flex flex-col items-center justify-center leading-tight">
          {showShortcuts && (
            <span className="text-[11px] text-neutral-400">esc</span>
          )}
          <span>Quit</span>
        </div>
      </button>
    </div>
  );
}
