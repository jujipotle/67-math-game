"use client";

type Standing = {
  name: string;
  score: number;
  isYou?: boolean;
};

type RoomWaitingProps = {
  roomName: string;
  timerDisplay: string;
  onPractice: () => void;
  onWait: () => void;
  onLeave: () => void;
  waitingOnly: boolean;
  standings?: Standing[] | null;
};

export default function RoomWaiting({
  roomName,
  timerDisplay,
  onPractice,
  onWait,
  onLeave,
  waitingOnly,
  standings,
}: RoomWaitingProps) {
  return (
    <div
      className="fixed inset-0 overflow-y-auto"
      style={{
        paddingTop: "max(2rem, env(safe-area-inset-top, 2rem))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))",
      }}
    >
      <div className="flex flex-col items-center px-5 max-w-md mx-auto w-full">
        <h1 className="text-2xl font-bold mb-1">Round in progress</h1>
        <p className="text-neutral-500 text-sm mb-2 text-center">{roomName}</p>
        <div className="text-4xl font-mono font-semibold tabular-nums mb-2">{timerDisplay}</div>
        {standings && standings.length > 0 ? (
          <div className="w-full mb-4 rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-600">
            {standings.map((s) => (
              <div
                key={s.name}
                className={`flex justify-between tabular-nums py-0.5 ${
                  s.isYou ? "font-semibold text-neutral-900" : ""
                }`}
              >
                <span>
                  {s.name}
                  {s.isYou ? " (you)" : ""}
                </span>
                <span>{s.score}</span>
              </div>
            ))}
          </div>
        ) : null}
        <p className="text-neutral-500 text-sm mb-6 text-center">
          You joined mid-round. You&apos;ll jump to the results when time is up.
        </p>

        {waitingOnly ? (
          <div className="w-full text-center text-sm text-neutral-500 mb-4">
            Waiting for the round to finish…
          </div>
        ) : (
          <div className="w-full flex flex-col gap-3 mb-4">
            <button
              type="button"
              onClick={onPractice}
              className="w-full h-14 rounded-xl bg-neutral-900 text-white font-medium text-lg"
            >
              Practice while you wait
            </button>
            <button
              type="button"
              onClick={onWait}
              className="w-full h-12 rounded-xl border-2 border-neutral-300 text-neutral-600 font-medium"
            >
              Just wait
            </button>
          </div>
        )}

        {waitingOnly && (
          <button
            type="button"
            onClick={onPractice}
            className="w-full h-12 mb-3 rounded-xl border-2 border-neutral-300 text-neutral-700 font-medium"
          >
            Practice instead
          </button>
        )}

        <button
          type="button"
          onClick={onLeave}
          className="w-full h-12 rounded-xl border-2 border-neutral-300 text-neutral-600 font-medium"
        >
          Leave room
        </button>
      </div>
    </div>
  );
}
