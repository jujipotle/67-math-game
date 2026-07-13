"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type DataTarget = "local" | "production";

/** Whether the app is running under `npm run dev`. The toggle only exists here. */
export const isDev = process.env.NODE_ENV === "development";

const STORAGE_KEY = "dataSource";

type DataSourceContextValue = {
  target: DataTarget;
  setTarget: (t: DataTarget) => void;
  isDev: boolean;
};

const DataSourceContext = createContext<DataSourceContextValue>({
  target: "production",
  setTarget: () => {},
  isDev,
});

/**
 * Single source of truth for which database the app reads/writes: the local
 * SQLite dev DB ("local") or the live production Neon DB ("production").
 *
 * Only meaningful in development. In a production build the value is always
 * "production" (the deployed app talks to its own API), so the toggle is hidden
 * and requests go straight to the same-origin API.
 */
export function DataSourceProvider({ children }: { children: ReactNode }) {
  const [target, setTargetState] = useState<DataTarget>(isDev ? "local" : "production");

  useEffect(() => {
    // Read the persisted choice only after mount. Rendering the default first and
    // syncing here (rather than in a lazy initializer) avoids SSR hydration
    // mismatches, since localStorage is client-only.
    if (!isDev) return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "local" || saved === "production") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTargetState(saved);
    }
  }, []);

  const setTarget = (t: DataTarget) => {
    setTargetState(t);
    if (isDev) localStorage.setItem(STORAGE_KEY, t);
  };

  return (
    <DataSourceContext.Provider
      value={{ target: isDev ? target : "production", setTarget, isDev }}
    >
      {children}
    </DataSourceContext.Provider>
  );
}

export function useDataSource() {
  return useContext(DataSourceContext);
}
