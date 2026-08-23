/** In-process wakeups so waiters on the same isolate return as soon as a room mutates. */
const waiters = new Map<string, Set<() => void>>();

export const ROOM_LONG_POLL_MS = 8000;
export const ROOM_WAIT_SLICE_MS = 25;

export function notifyRoomChange(roomId: string): void {
  const set = waiters.get(roomId);
  if (!set) return;
  for (const fn of [...set]) fn();
}

export function waitForRoomNotify(
  roomId: string,
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const set = waiters.get(roomId) ?? new Set<() => void>();
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      set.delete(finish);
      if (set.size === 0) waiters.delete(roomId);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    set.add(finish);
    waiters.set(roomId, set);
    signal?.addEventListener("abort", finish);
  });
}
