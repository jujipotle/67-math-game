"use client";

import { Tile } from "@/lib/types";
import { ratToString } from "@/lib/rational";
import { cardShortcutLabels } from "@/lib/keyboardShortcuts";

type CardGridProps = {
  tiles: Tile[];
  selectedIndex: number | null;
  onTileClick: (index: number) => void;
  useFaceCards: boolean;
  showShortcuts: boolean;
  numpadCardLayout: boolean;
  highlightWrong?: boolean;
};

export default function CardGrid({
  tiles,
  selectedIndex,
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

        return (
          <button
            key={tile.id}
            disabled={!tile.alive}
            onClick={() => onTileClick(i)}
            className={`
              relative flex items-center justify-center
              aspect-[4/3] rounded-xl text-2xl sm:text-3xl font-semibold tabular-nums
              transition-all duration-100 select-none
              ${
                tile.alive
                  ? isWrong
                    ? "bg-red-50 text-red-700 border-2 border-red-500"
                    : isSelected
                      ? "bg-neutral-900 text-white ring-2 ring-neutral-900 ring-offset-2"
                      : "bg-neutral-100 text-neutral-900 active:bg-neutral-300"
                  : "bg-neutral-50 border border-dashed border-neutral-200 cursor-default"
              }
            `}
          >
            <div className="flex flex-col items-center justify-center leading-tight">
              {showShortcuts && tile.alive && display && (
                <span className="text-[11px] text-neutral-400 select-none pointer-events-none">
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
