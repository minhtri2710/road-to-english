import { syncState } from "../api/sync";
import { claimOwner, exportAll, mergeInto } from "./backupStore";
import type { SyncState } from "./backup";

export interface SyncScheduler {
  trigger(): void;
  stop(): void;
}

export function createSyncScheduler(
  userId: string,
  onApplied: () => Promise<void>,
  onOwnerMismatch: () => void,
): SyncScheduler {
  let active = true;
  let running = false;
  let dirty = false;

  const run = async (): Promise<void> => {
    if (!active || running) {
      return;
    }
    running = true;
    do {
      dirty = false;
      try {
        if (!await claimOwner(userId)) {
          onOwnerMismatch();
          break;
        }
        if (!active) {
          break;
        }
        const local: SyncState = await exportAll();
        if (!active) {
          break;
        }
        const remote = await syncState(local);
        if (!active) {
          break;
        }
        await mergeInto(remote);
        if (!active) {
          break;
        }
        await onApplied();
      } catch {
        // Sync is background work; retain local IndexedDB as the source of truth.
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
