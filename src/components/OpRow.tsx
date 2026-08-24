"use client";

import { Op } from "@/lib/types";
import { opShortcutLabel } from "@/lib/keyboardShortcuts";

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
  showShortcuts: boolean;
};

export default function OpRow({ selectedOp, disabled, onOpClick, showShortcuts }: OpRowProps) {
  return (
    <div className="flex gap-2.5 px-4 py-3 max-w-sm mx-auto w-full">
      {OPS.map(({ op, label }) => {
        const hotkey = opShortcutLabel(op);
        return (
          <button
            key={op}
            type="button"
            // Keep clickable even when muted so a tap right after selecting a card is never dropped.
            aria-disabled={disabled}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              (e.currentTarget as HTMLButtonElement).dataset.handled = "1";
              onOpClick(op);
            }}
            onClick={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              if (el.dataset.handled === "1") {
                delete el.dataset.handled;
                return;
              }
              onOpClick(op);
            }}
            className={`
              flex-1 min-w-0 h-16 rounded-xl text-2xl sm:text-3xl font-semibold
              transition-colors duration-75 select-none touch-manipulation
              ${disabled
                ? "bg-neutral-50 text-neutral-300"
                : selectedOp === op
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-700 active:bg-neutral-300"
              }
            `}
          >
            <div className="flex flex-col items-center justify-center leading-tight pointer-events-none">
              {showShortcuts && (
                <span className="text-[11px] text-neutral-400">{hotkey}</span>
              )}
              <span>{label}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
