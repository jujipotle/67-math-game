"use client";

import { Tile } from "@/lib/types";
import { ratToString } from "@/lib/rational";

type CardGridProps = {
  tiles: Tile[];
  selectedIndex: number | null;
  onTileClick: (index: number) => void;
};

export default function CardGrid({ tiles, selectedIndex, onTileClick }: CardGridProps) {
  return (
    <div className="grid grid-cols-3 gap-2.5 px-4 max-w-sm mx-auto w-full">
      {tiles.map((tile, i) => {
        const isSelected = selectedIndex === i;
        const display = tile.alive ? ratToString(tile.value) : "";

        return (
          <button
            key={tile.id}
            disabled={!tile.alive}
            onClick={() => onTileClick(i)}
            className={`
              relative flex items-center justify-center
              aspect-[4/3] rounded-xl text-2xl font-semibold tabular-nums
              transition-all duration-100 select-none
              ${tile.alive
                ? isSelected
                  ? "bg-neutral-900 text-white ring-2 ring-neutral-900 ring-offset-2"
                  : "bg-neutral-100 text-neutral-900 active:bg-neutral-300"
                : "bg-neutral-50 border border-dashed border-neutral-200 cursor-default"
              }
            `}
          >
            {display}
          </button>
        );
      })}
    </div>
  );
}
