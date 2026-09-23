import { ApiError, getUrl } from "./lessons";
import { reviveSyncState, type SyncState } from "../lib/backup";

export async function syncState(local: SyncState): Promise<SyncState> {
  const response = await fetch(getUrl("/sync"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(local),
  });

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  return reviveSyncState(await response.json());
}
