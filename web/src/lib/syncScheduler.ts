import { ApiError, NetworkError } from "../api/client";
import { syncState } from "../api/sync";
import { claimOwner, exportAll, mergeInto } from "./backupStore";
import type { SyncRequest } from "./backup";

// offline, server, rejected, badReply and local are failed runs, named by where they failed.
export type SyncStatus =
  | "synced"
  | "offline"
  | "server"
  | "rejected"
  | "badReply"
  | "local"
  | "signedOut"
  | "ownerMismatch"
  | "tooLarge";

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
  // The body the server refused with 413 or 400, its status and code; the same body is never re-sent.
  let refused: { body: string; status: "tooLarge" | "rejected"; code: string | null } | null = null;

  // Returns null when the scheduler stopped mid-run.
  const attempt = async (): Promise<{ status: SyncStatus; code: string | null } | null> => {
    let body = "";
    // Only syncState's errors come from the server; every other call reads or writes IndexedDB.
    let sending = false;
    try {
      if (!await claimOwner(userId)) {
        return { status: "ownerMismatch", code: null };
      }
      if (!active) {
        return null;
      }
      const local: SyncRequest = await exportAll();
      if (!active) {
        return null;
      }
      body = JSON.stringify(local);
      if (refused?.body === body) {
        return { status: refused.status, code: refused.code };
      }
      sending = true;
      const remote = await syncState(local);
      sending = false;
      refused = null;
      if (!active) {
        return null;
      }
      // A mismatched epoch marked every card dirty: one follow-up run re-pushes them.
      if (await mergeInto(remote, local.cards)) {
        dirty = true;
      }
      if (!active) {
        return null;
      }
      await onApplied();
      return { status: "synced", code: null };
    } catch (error) {
      // Local IndexedDB stays the source of truth; the status tells the App what happened.
      if (!sending) {
        return { status: "local", code: null };
      }
      if (error instanceof NetworkError) {
        return { status: "offline", code: null };
      }
      // A reply arrived but its JSON or its state shape could not be read.
      if (!(error instanceof ApiError)) {
        return { status: "badReply", code: null };
      }
      if (error.status === 413 || error.status === 400) {
        refused = { body, status: error.status === 413 ? "tooLarge" : "rejected", code: error.status === 413 ? error.code : null };
        return { status: refused.status, code: refused.code };
      }
      return { status: error.status === 401 ? "signedOut" : "server", code: null };
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
