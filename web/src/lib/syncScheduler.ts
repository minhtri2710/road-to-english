import { ApiError } from "../api/client";
import { syncState } from "../api/sync";
import { claimOwner, exportAll, mergeInto } from "./backupStore";
import type { SyncState } from "./backup";

export type SyncStatus = "synced" | "failed" | "signedOut" | "ownerMismatch";

export interface SyncScheduler {
  trigger(): void;
  stop(): void;
}

// onStatus hears every finished run; a stopped scheduler reports nothing.
export function createSyncScheduler(
  userId: string,
  onApplied: () => Promise<void>,
  onStatus: (status: SyncStatus) => void,
): SyncScheduler {
  let active = true;
  let running = false;
  let dirty = false;

  // Returns null when the scheduler stopped mid-run.
  const attempt = async (): Promise<SyncStatus | null> => {
    try {
      if (!await claimOwner(userId)) {
        return "ownerMismatch";
      }
      if (!active) {
        return null;
      }
      const local: SyncState = await exportAll();
      if (!active) {
        return null;
      }
      const remote = await syncState(local);
      if (!active) {
        return null;
      }
      await mergeInto(remote);
      if (!active) {
        return null;
      }
      await onApplied();
      return "synced";
    } catch (error) {
      // Local IndexedDB stays the source of truth; the status tells the App what happened.
      return error instanceof ApiError && error.status === 401 ? "signedOut" : "failed";
    }
  };

  const run = async (): Promise<void> => {
    if (!active || running) {
      return;
    }
    running = true;
    do {
      dirty = false;
      const status = await attempt();
      if (status === null || !active) {
        break;
      }
      onStatus(status);
      if (status !== "synced") {
        break;
      }
    } while (active && dirty);
    running = false;
  };

  return {
    trigger() {
      if (!active) {
        return;
      }
      dirty = true;
      void run();
    },
    stop() {
      active = false;
    },
  };
}
