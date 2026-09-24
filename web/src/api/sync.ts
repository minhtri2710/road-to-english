import { request } from "./client";
import { reviveSyncState, type SyncState } from "../lib/backup";

export async function syncState(local: SyncState): Promise<SyncState> {
  return reviveSyncState(
    await request<unknown>("/sync", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(local),
    }),
  );
}
