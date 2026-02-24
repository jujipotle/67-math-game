"use client";

type GoalDisplayProps = {
  goal: number;
};

export default function GoalDisplay({ goal }: GoalDisplayProps) {
  return (
    <div className="flex flex-col items-center py-4 sm:py-6">
      <span className="text-[11px] sm:text-xs uppercase tracking-widest text-neutral-400 mb-1">
        Target
      </span>
      <span className="text-6xl sm:text-7xl font-bold tabular-nums">{goal}</span>
    </div>
  );
}
