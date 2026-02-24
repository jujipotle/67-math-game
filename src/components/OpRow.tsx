"use client";

import { Op } from "@/lib/types";

const OPS: { op: Op; label: string }[] = [
  { op: "+", label: "+" },
  { op: "-", label: "−" },
  { op: "*", label: "×" },
  { op: "/", label: "÷" },
];

type OpRowProps = {
  selectedOp: Op | null;
  disabled: boolean;
  onOpClick: (op: Op) => void;
};

export default function OpRow({ selectedOp, disabled, onOpClick }: OpRowProps) {
  return (
    <div className="flex gap-2.5 px-4 py-3 max-w-sm mx-auto w-full">
      {OPS.map(({ op, label }) => (
        <button
          key={op}
          disabled={disabled}
          onClick={() => onOpClick(op)}
          className={`
            flex-1 min-w-0 h-16 rounded-xl text-2xl font-semibold
            transition-all duration-100 select-none
            ${disabled
              ? "bg-neutral-50 text-neutral-300 cursor-not-allowed"
              : selectedOp === op
                ? "bg-neutral-900 text-white"
                : "bg-neutral-100 text-neutral-700 active:bg-neutral-300"
            }
          `}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
