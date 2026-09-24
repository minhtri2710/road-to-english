import { useEffect, useRef, useState } from "react";

import type { AuthState } from "./auth";
import type { useProgress } from "./progress";
import type { useVocabDeck } from "./vocab";
import { createSyncScheduler, syncedAgo, type SyncScheduler } from "../lib/syncScheduler";
import { setSyncTrigger } from "../lib/syncEvents";

// The last finished run. syncedAt is when it synced (ms); recovered marks a sync that followed a failure.
type SyncRun =
  | { status: "synced"; syncedAt: number; recovered: boolean }
  | { status: "failed" | "ownerMismatch" };

export interface SyncLine {
  status: SyncRun["status"];
  text: string;
  recovered: boolean;
}

const problemText = {
  failed: "Saved on this device. Will sync when you're back online.",
  ownerMismatch: "This device's data belongs to another account, so sync is off. Sign in with that account to sync.",
};

// Wires local mutations to the sync scheduler and runs one scheduler per signed-in user.
// Returns the sync line to show, or null while signed out or before the first run finishes.
export function useSync(
  auth: Pick<AuthState, "user" | "expire">,
  deck: Pick<ReturnType<typeof useVocabDeck>, "reload">,
  progress: Pick<ReturnType<typeof useProgress>, "reload">,
): SyncLine | null {
  const { expire } = auth;
  const syncRef = useRef<SyncScheduler | null>(null);
  const [run, setRun] = useState<SyncRun | null>(null);
  const [now, setNow] = useState(Date.now);
  const syncedAt = run?.status === "synced" ? run.syncedAt : null;

  // Refreshes "Synced N min ago" once a minute.
  useEffect(() => {
    if (syncedAt === null) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [syncedAt]);

  useEffect(() => {
    setSyncTrigger(() => syncRef.current?.trigger());
    return () => setSyncTrigger(undefined);
  }, []);

  useEffect(() => {
    syncRef.current?.stop();
    syncRef.current = null;
    setRun(null);
    if (!auth.user) {
      return;
    }
    const scheduler = createSyncScheduler(
      auth.user.id,
      async () => {
        await Promise.all([deck.reload(), progress.reload()]);
      },
      (status) => {
        if (status === "signedOut") {
          expire();
          return;
        }
        if (status === "synced") {
          const finishedAt = Date.now();
          setNow(finishedAt);
          setRun((previous) => ({
            status,
            syncedAt: finishedAt,
            recovered: previous?.status === "failed" || (previous?.status === "synced" && previous.recovered),
          }));
          return;
        }
        setRun({ status });
      },
    );
    syncRef.current = scheduler;
    scheduler.trigger();
    const retry = () => {
      if (document.visibilityState === "visible") {
        scheduler.trigger();
      }
    };
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", retry);
      scheduler.stop();
      if (syncRef.current === scheduler) {
        syncRef.current = null;
      }
    };
  }, [auth.user, expire, deck.reload, progress.reload]);

  if (run === null) {
    return null;
  }
  return run.status === "synced"
    ? { status: run.status, text: syncedAgo(run.syncedAt, now), recovered: run.recovered }
    : { status: run.status, text: problemText[run.status], recovered: false };
}
