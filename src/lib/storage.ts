import { SavedSession, SolvedRecord } from "./types";
import { serializeRational, deserializeRational } from "./rational";

const SESSIONS_KEY = "67-game-sessions";

function serializeSolved(records: SolvedRecord[]): string {
  return JSON.stringify(
    records.map((r) => ({
      ...r,
      userSteps: r.userSteps.map((s) => ({
        ...s,
        resultValue: serializeRational(s.resultValue),
      })),
    }))
  );
}

function deserializeSolved(raw: string): SolvedRecord[] {
  const arr = JSON.parse(raw);
  return arr.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => ({
      ...r,
      userSteps: r.userSteps.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) => ({
          ...s,
          resultValue: deserializeRational(s.resultValue),
        })
      ),
    })
  );
}

export function saveSession(session: SavedSession): void {
  const existing = loadSessions();
  const toStore = existing.map((s) => ({
    ...s,
    solved: JSON.parse(serializeSolved(s.solved)),
  }));
  toStore.push({
    ...session,
    solved: JSON.parse(serializeSolved(session.solved)),
  });
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(toStore));
}

export function loadSessions(): SavedSession[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(SESSIONS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return arr.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => ({
        ...s,
        solved: deserializeSolved(JSON.stringify(s.solved)),
      })
    );
  } catch {
    return [];
  }
}
