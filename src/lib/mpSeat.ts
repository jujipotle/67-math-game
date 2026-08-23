const KEY = "67-mp-seat";

export type MpSeat = {
  roomId: string;
  playerId: string;
  roomName: string;
};

export function saveMpSeat(seat: MpSeat): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(seat));
  } catch {
    // ignore quota / private mode
  }
}

export function loadMpSeat(): MpSeat | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MpSeat>;
    if (
      typeof parsed.roomId === "string" &&
      typeof parsed.playerId === "string" &&
      typeof parsed.roomName === "string"
    ) {
      return {
        roomId: parsed.roomId,
        playerId: parsed.playerId,
        roomName: parsed.roomName,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

export function clearMpSeat(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
