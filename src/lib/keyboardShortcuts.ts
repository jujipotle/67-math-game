import type { Op } from "./types";

/** Card hint labels when shortcuts are shown (index 0–5). */
export function cardShortcutLabels(numpadCardLayout: boolean): string[] {
  return numpadCardLayout
    ? ["4", "5", "6", "1", "2", "3"]
    : ["1", "2", "3", "4", "5", "6"];
}

const OP_KEYS: Record<Op, string> = {
  "+": "Q",
  "-": "W",
  "*": "E",
  "/": "R",
};

export function opShortcutLabel(op: Op): string {
  return OP_KEYS[op];
}

export const UNDO_KEY = "esc";
export const SKIP_KEY = "space";

function cardDigitFromCode(code: string): number | null {
  if (code.startsWith("Digit") && code.length === 6) {
    const n = Number(code.slice(5));
    if (n >= 1 && n <= 6) return n;
  }
  if (code.startsWith("Numpad") && code.length === 7) {
    const n = Number(code.slice(6));
    if (n >= 1 && n <= 6) return n;
  }
  return null;
}

/** Map event.code → card tile index, or null if not a card key. */
export function cardIndexFromCode(
  code: string,
  numpadCardLayout: boolean,
): number | null {
  const digit = cardDigitFromCode(code);
  if (digit === null) return null;

  if (numpadCardLayout) {
    // Numpad-style grid: 4 5 6 top, 1 2 3 bottom (top row or numpad keys).
    return digit <= 3 ? digit + 2 : digit - 4;
  }

  // Default grid: 1 2 3 top, 4 5 6 bottom.
  return digit - 1;
}

export function opFromCode(code: string): Op | null {
  switch (code) {
    case "KeyQ":
      return "+";
    case "KeyW":
      return "-";
    case "KeyE":
      return "*";
    case "KeyR":
      return "/";
    default:
      return null;
  }
}

export function isUndoKey(rawKey: string): boolean {
  return rawKey === "Escape";
}

export function isSkipKey(rawKey: string): boolean {
  return rawKey === " ";
}
