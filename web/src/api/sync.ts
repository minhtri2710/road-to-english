import { ApiError, getUrl } from "./lessons";
import { reviveBackupData, type BackupData } from "../lib/backup";

export async function syncState(local: BackupData): Promise<BackupData> {
  const response = await fetch(getUrl("/sync"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(local),
  });

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  return reviveBackupData(await response.json());
}
