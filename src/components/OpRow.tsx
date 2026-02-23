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
    <div className="flex justify-center gap-3 px-4 py-3">
      {OPS.map(({ op, label }) => (
        <button
          key={op}
          disabled={disabled}
          onClick={() => onOpClick(op)}
          className={`
            w-14 h-14 rounded-xl text-xl font-semibold
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
