import type { Op } from "./types";

/** Card hint labels when shortcuts are shown (index 0–5). */
export function cardShortcutLabels(numpadCardLayout: boolean): string[] {
  return numpadCardLayout
    ? ["4", "5", "6", "1", "2", "3"]
    : ["1", "2", "3", "Q", "W", "E"];
}

const OP_KEYS: Record<Op, string> = {
  "+": "A",
  "-": "S",
  "*": "D",
  "/": "F",
};

export function opShortcutLabel(op: Op): string {
  return OP_KEYS[op];
}

export const UNDO_KEY = "Z";
export const SKIP_KEY = "X";

/** Map event.code / key → card tile index (0–5), or null if not a card key. */
export function cardIndexFromCode(
  code: string,
  numpadCardLayout: boolean,
  rawKey?: string,
): number | null {
  // Numpad physical keys: 4 5 6 top row (indices 0, 1, 2), 1 2 3 bottom row (indices 3, 4, 5)
  switch (code) {
    case "Numpad4":
      return 0;
    case "Numpad5":
      return 1;
    case "Numpad6":
      return 2;
    case "Numpad1":
      return 3;
    case "Numpad2":
      return 4;
    case "Numpad3":
      return 5;
  }

  if (numpadCardLayout) {
    switch (code) {
      case "Digit4":
        return 0;
      case "Digit5":
        return 1;
      case "Digit6":
        return 2;
      case "Digit1":
        return 3;
      case "Digit2":
        return 4;
      case "Digit3":
        return 5;
    }
    if (rawKey) {
      switch (rawKey) {
        case "4":
          return 0;
        case "5":
          return 1;
        case "6":
          return 2;
        case "1":
          return 3;
        case "2":
          return 4;
        case "3":
          return 5;
      }
    }
    return null;
  }

  // Default layout: 1 2 3 top row, Q W E bottom row
  switch (code) {
    case "Digit1":
      return 0;
    case "Digit2":
      return 1;
    case "Digit3":
      return 2;
    case "KeyQ":
      return 3;
    case "KeyW":
      return 4;
    case "KeyE":
      return 5;
  }
  if (rawKey) {
    const k = rawKey.toLowerCase();
    switch (k) {
      case "1":
        return 0;
      case "2":
        return 1;
      case "3":
        return 2;
      case "q":
        return 3;
      case "w":
        return 4;
      case "e":
        return 5;
    }
  }

  return null;
}

export function opFromCode(code: string, rawKey?: string): Op | null {
  switch (code) {
    case "KeyA":
    case "NumpadAdd":
      return "+";
    case "KeyS":
    case "NumpadSubtract":
      return "-";
    case "KeyD":
    case "NumpadMultiply":
      return "*";
    case "KeyF":
    case "NumpadDivide":
      return "/";
  }
  if (rawKey) {
    const k = rawKey.toLowerCase();
    if (k === "a") return "+";
    if (k === "s") return "-";
    if (k === "d") return "*";
    if (k === "f") return "/";
  }
  return null;
}

export function isUndoKey(rawKey: string, code?: string): boolean {
  return rawKey.toLowerCase() === "z" || code === "KeyZ";
}

export function isSkipKey(rawKey: string, code?: string): boolean {
  return rawKey.toLowerCase() === "x" || code === "KeyX";
}
