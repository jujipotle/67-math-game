"use client";

import { Tile } from "@/lib/types";
import { ratToString } from "@/lib/rational";
import { cardShortcutLabels } from "@/lib/keyboardShortcuts";

type CardGridProps = {
  tiles: Tile[];
  selectedIndex: number | null;
  /** True once an operator is chosen — remaining cards are merge targets. */
  hasOp?: boolean;
  onTileClick: (index: number) => void;
  useFaceCards: boolean;
  showShortcuts: boolean;
  numpadCardLayout: boolean;
  highlightWrong?: boolean;
};

export default function CardGrid({
  tiles,
  selectedIndex,
  hasOp = false,
  onTileClick,
  useFaceCards,
  showShortcuts,
  numpadCardLayout,
  highlightWrong,
}: CardGridProps) {
  const hints = cardShortcutLabels(numpadCardLayout);
  return (
    <div className="grid grid-cols-3 gap-2.5 px-4 max-w-sm mx-auto w-full">
      {tiles.map((tile, i) => {
        const isSelected = selectedIndex === i;
        const hotkeyLabel = hints[i] ?? String(i + 1);

        let display = "";
        if (tile.alive) {
          if (useFaceCards && tile.value.d === 1n) {
            const intVal = Number(tile.value.n);
            if (intVal === 1) {
              display = "A";
            } else if (intVal === 11) {
              display = "J";
            } else if (intVal === 12) {
              display = "Q";
            } else if (intVal === 13) {
              display = "K";
            } else {
              display = ratToString(tile.value);
            }
          } else {
            display = ratToString(tile.value);
          }
        }

        const isWrong = highlightWrong && tile.alive;
        const isMergeTarget = tile.alive && hasOp && !isSelected;

        let style = "bg-neutral-50 border border-dashed border-neutral-200 cursor-default";
        if (tile.alive) {
          if (isWrong) {
            style = "bg-red-50 text-red-700 border-2 border-red-500";
          } else if (isSelected && hasOp) {
            style = "bg-neutral-900 text-white ring-2 ring-neutral-900 ring-offset-2";
          } else if (isSelected) {
            style =
              "bg-neutral-100 text-neutral-900 border-2 border-neutral-900 ring-2 ring-neutral-900/15 ring-offset-1";
          } else if (isMergeTarget) {
            style = "bg-neutral-100 text-neutral-900 ring-2 ring-neutral-300 active:bg-neutral-300";
          } else {
            style = "bg-neutral-100 text-neutral-900 active:bg-neutral-300";
          }
        }

        return (
          <button
            key={tile.id}
            type="button"
            disabled={!tile.alive}
            onPointerDown={(e) => {
              if (!tile.alive || e.button !== 0) return;
              e.preventDefault();
              (e.currentTarget as HTMLButtonElement).dataset.handled = "1";
              onTileClick(i);
            }}
            onClick={(e) => {
              if (!tile.alive) return;
              const el = e.currentTarget as HTMLButtonElement;
              if (el.dataset.handled === "1") {
                delete el.dataset.handled;
                return;
              }
              onTileClick(i);
            }}
            className={`
              relative flex items-center justify-center
              aspect-[4/3] rounded-xl text-2xl sm:text-3xl font-semibold tabular-nums
              transition-colors duration-75 select-none touch-manipulation
              ${style}
            `}
          >
            <div className="flex flex-col items-center justify-center leading-tight pointer-events-none">
              {showShortcuts && tile.alive && display && (
                <span className="text-[11px] text-neutral-400 select-none">
                  {hotkeyLabel}
                </span>
              )}
              <span>{display}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
