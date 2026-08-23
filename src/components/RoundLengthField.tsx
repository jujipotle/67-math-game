"use client";

import { useEffect, useState } from "react";
import {
  clampRoundMinutes,
  MAX_ROUND_MINUTES,
  MIN_ROUND_MINUTES,
  minutesToRoundMs,
  roundMsToMinutes,
} from "@/lib/duration";

type RoundLengthFieldProps = {
  durationMs: number;
  editable: boolean;
  onCommit: (durationMs: number) => void;
  className?: string;
};

export default function RoundLengthField({
  durationMs,
  editable,
  onCommit,
  className = "mb-3",
}: RoundLengthFieldProps) {
  const fromProps = roundMsToMinutes(durationMs);
  const [minutes, setMinutes] = useState(fromProps);

  useEffect(() => {
    setMinutes(fromProps);
  }, [fromProps]);

  const bump = (delta: number) => {
    const next = clampRoundMinutes(minutes + delta);
    if (next === minutes) return;
    setMinutes(next);
    onCommit(minutesToRoundMs(next));
  };

  const atMin = minutes <= MIN_ROUND_MINUTES;
  const atMax = minutes >= MAX_ROUND_MINUTES;
  const label = `${minutes} min`;

  const arrowBtn =
    "h-5 w-7 rounded-md text-[10px] leading-none flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed";

  return (
    <div className={`${className} w-full flex flex-col items-center`}>
      <div className="text-sm font-medium text-neutral-600 mb-1">Round length</div>
      {editable ? (
        <div className="flex items-center gap-1">
          <div className="h-10 min-w-[5.5rem] px-3 rounded-xl border border-neutral-300 font-mono tabular-nums text-sm font-medium text-neutral-800 flex items-center justify-center">
            {label}
          </div>
          <div className="flex flex-col">
            <button
              type="button"
              aria-label="Increase round length"
              disabled={atMax}
              onClick={() => bump(1)}
              className={`${arrowBtn} ${atMax ? "" : "hover:bg-neutral-100 active:bg-neutral-200"}`}
            >
              ▲
            </button>
            <button
              type="button"
              aria-label="Decrease round length"
              disabled={atMin}
              onClick={() => bump(-1)}
              className={`${arrowBtn} ${atMin ? "" : "hover:bg-neutral-100 active:bg-neutral-200"}`}
            >
              ▼
            </button>
          </div>
        </div>
      ) : (
        <div className="h-10 min-w-[5.5rem] px-3 rounded-xl border border-neutral-200 font-mono tabular-nums text-sm font-medium text-neutral-800 flex items-center justify-center">
          {label}
        </div>
      )}
    </div>
  );
}
