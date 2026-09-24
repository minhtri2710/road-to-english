import { useEffect, useRef, useState } from "react";

import type { AuthState } from "./auth";
import type { useProgress } from "./progress";
import type { useVocabDeck } from "./vocab";
import { createSyncScheduler, type SyncScheduler, type SyncStatus } from "../lib/syncScheduler";
import { setSyncTrigger } from "../lib/syncEvents";

const syncMessages: Record<Exclude<SyncStatus, "signedOut">, string | null> = {
  synced: null,
  failed: "Couldn't sync. Your changes are saved on this device and will sync when you're back online.",
  ownerMismatch: "This device's data belongs to another account, so sync is off. Sign in with that account to sync.",
};

// Wires local mutations to the sync scheduler and runs one scheduler per signed-in user.
// Returns the sync problem to show, or null.
export function useSync(
  auth: Pick<AuthState, "user" | "expire">,
  deck: Pick<ReturnType<typeof useVocabDeck>, "reload">,
  progress: Pick<ReturnType<typeof useProgress>, "reload">,
): string | null {
  const { expire } = auth;
  const syncRef = useRef<SyncScheduler | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    setSyncTrigger(() => syncRef.current?.trigger());
    return () => setSyncTrigger(undefined);
  }, []);

  useEffect(() => {
    syncRef.current?.stop();
    syncRef.current = null;
    setSyncMessage(null);
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
        setSyncMessage(syncMessages[status]);
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

  return syncMessage;
}
