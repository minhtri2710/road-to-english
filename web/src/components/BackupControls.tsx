import { useRef, type ChangeEvent } from "react";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import * as stylex from "@stylexjs/stylex";

import { backupFileName, exportData, importData } from "../lib/backup";
import { exportBackupData, replaceAll } from "../lib/backupStore";
import { cardsCsv, cardsCsvFileName } from "../lib/csv";
import { getAllCards } from "../lib/vocabStore";
import { sharedStyles } from "./styles";

const styles = stylex.create({
  backupFileInput: {
    display: "none",
  },
});

function downloadText(text: string, type: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Export, Export CSV and Import. The parent shows the error line in the header and reloads its
// data in onImported; a failing onImported reports as an import error.
export function BackupControls({
  signedIn,
  setError,
  onImported,
}: {
  signedIn: boolean;
  setError: (message: string | null) => void;
  onImported: () => Promise<void>;
}) {
  const importInput = useRef<HTMLInputElement>(null);

  const exportBackup = async () => {
    setError(null);
    try {
      downloadText(exportData(await exportBackupData(), new Date()), "application/json", backupFileName(new Date()));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to export backup.");
    }
  };

  const exportCsv = async () => {
    setError(null);
    try {
      downloadText(cardsCsv(await getAllCards()), "text/csv;charset=utf-8", cardsCsvFileName(new Date()));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to export CSV.");
    }
  };

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }

    try {
      const data = importData(await file.text());
      const replaceNotice = "Importing this backup will replace all local data on this device.";
      const confirmText = signedIn
        ? `${replaceNotice} Your next sync merges it with your account, so cards and progress already in your account stay. Continue?`
        : `${replaceNotice} Continue?`;
      if (!window.confirm(confirmText)) {
        return;
      }
      await replaceAll(data);
      await onImported();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to import backup.");
    }
  };

  return (
    <HStack gap={1} align="center" xstyle={sharedStyles.shadowingControls}>
      <Button label="Export" variant="secondary" onClick={() => void exportBackup()} />
      <Button label="Export CSV" variant="secondary" onClick={() => void exportCsv()} />
      <Button
        label="Import"
        variant="secondary"
        onClick={() => importInput.current?.click()}
      />
      <input
        ref={importInput}
        className={stylex.props(styles.backupFileInput).className}
        type="file"
        accept="application/json"
        aria-label="Import backup file"
        onChange={(event) => void importBackup(event)}
      />
    </HStack>
  );
}
