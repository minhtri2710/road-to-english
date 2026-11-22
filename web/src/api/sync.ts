import { tr } from "../i18n";
import { request } from "./client";
import { reviveSyncState, type SyncReply, type SyncState } from "../lib/backup";
import { isRecord } from "../lib/vocab";

export async function syncState(local: SyncState, ownerId: string): Promise<SyncReply> {
  const reply = await request<unknown>("/sync", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-RTE-Sync-Owner": ownerId },
    body: JSON.stringify(local),
  });
  if (!isRecord(reply) || typeof reply.syncEpoch !== "string" || reply.syncEpoch === "") {
    throw new Error(tr("Invalid sync epoch."));
  }
  return { ...reviveSyncState(reply), syncEpoch: reply.syncEpoch };
}
