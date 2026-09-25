import { request } from "./client";
import { reviveSyncState, type SyncReply, type SyncRequest } from "../lib/backup";
import { isRecord } from "../lib/vocab";

export async function syncState(local: SyncRequest): Promise<SyncReply> {
  const reply = await request<unknown>("/sync", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(local),
  });
  if (!isRecord(reply) || typeof reply.syncEpoch !== "string" || reply.syncEpoch === "") {
    throw new Error("Invalid sync epoch.");
  }
  return { ...reviveSyncState(reply), syncEpoch: reply.syncEpoch };
}
