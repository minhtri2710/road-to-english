import { ApiError } from "../api/client";
import { syncState } from "../api/sync";
import { claimOwner, exportAll, mergeInto } from "./backupStore";
import type { SyncState } from "./backup";

export type SyncStatus = "synced" | "failed" | "signedOut" | "ownerMismatch" | "tooLarge";

export interface SyncScheduler {
  trigger(): void;
  stop(): void;
}

// onStatus hears every finished run; a stopped scheduler reports nothing.
// code is the server's error for a tooLarge run and null otherwise.
export function createSyncScheduler(
  userId: string,
  onApplied: () => Promise<void>,
  onStatus: (status: SyncStatus, code: string | null) => void,
): SyncScheduler {
  let active = true;
  let running = false;
  let dirty = false;
  // The body the server refused with 413 and its code; the same body is never re-sent.
  let refused: { body: string; code: string | null } | null = null;

  // Returns null when the scheduler stopped mid-run.
  const attempt = async (): Promise<{ status: SyncStatus; code: string | null } | null> => {
    let body = "";
    try {
      if (!await claimOwner(userId)) {
        return { status: "ownerMismatch", code: null };
      }
      if (!active) {
        return null;
      }
      const local: SyncState = await exportAll();
      if (!active) {
        return null;
      }
      body = JSON.stringify(local);
      if (refused?.body === body) {
        return { status: "tooLarge", code: refused.code };
      }
      const remote = await syncState(local);
      refused = null;
      if (!active) {
        return null;
      }
      await mergeInto(remote);
      if (!active) {
        return null;
      }
      await onApplied();
      return { status: "synced", code: null };
    } catch (error) {
      // Local IndexedDB stays the source of truth; the status tells the App what happened.
      if (error instanceof ApiError && error.status === 413) {
        refused = { body, code: error.code };
        return { status: "tooLarge", code: error.code };
      }
      return { status: error instanceof ApiError && error.status === 401 ? "signedOut" : "failed", code: null };
    }
  };

  const run = async (): Promise<void> => {
    if (!active || running) {
      return;
    }
    running = true;
    do {
      dirty = false;
      const result = await attempt();
      if (result === null || !active) {
        break;
      }
      onStatus(result.status, result.code);
      if (result.status !== "synced") {
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

// The sync line for a run that finished at syncedAt (ms), read at now (ms).
export function syncedAgo(syncedAt: number, now: number): string {
  const minutes = Math.floor((now - syncedAt) / 60_000);
  if (minutes < 1) {
    return "Synced just now";
  }
  return minutes < 60 ? `Synced ${minutes} min ago` : `Synced ${Math.floor(minutes / 60)} h ago`;
}
