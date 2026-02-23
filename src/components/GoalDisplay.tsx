"use client";

type GoalDisplayProps = {
  goal: number;
};

export default function GoalDisplay({ goal }: GoalDisplayProps) {
  return (
    <div className="flex flex-col items-center py-4 sm:py-6">
      <span className="text-[10px] uppercase tracking-widest text-neutral-400 mb-0.5">
        Target
      </span>
      <span className="text-5xl sm:text-6xl font-bold tabular-nums">{goal}</span>
    </div>
  );
}
