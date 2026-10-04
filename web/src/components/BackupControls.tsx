import { useRef, type ChangeEvent } from "react";
import type { ReactNode } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { useT } from "../i18n";
import { backupFileName, exportData, importData } from "../lib/backup";
import { exportBackupData, replaceAll } from "../lib/backupStore";
import { cardsCsv, cardsCsvFileName } from "../lib/csv";
import { getAllCards } from "../lib/vocabStore";

const styles = stylex.create({
  backupFileInput: {
    display: "none",
  },
  // Settings rows: what an action does on the left, its button on the right; stacked on phones.
  rows: {
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--spacing-2) var(--spacing-4)",
    paddingBlock: "var(--spacing-3)",
    borderBlockStartWidth: { default: "1px", ":first-child": 0 },
    borderBlockStartStyle: "solid",
    borderBlockStartColor: "var(--color-border)",
  },
  rowText: {
    flex: "1 1 14rem",
    minWidth: 0,
  },
  rowAction: {
    flex: "0 0 auto",
  },
});

function Row({ title, description, action }: { title: string; description: string; action: ReactNode }) {
  return (
    <li className={stylex.props(styles.row).className}>
      <VStack gap={0} xstyle={styles.rowText}>
        <Text weight="semibold">{title}</Text>
        <Text type="supporting">{description}</Text>
      </VStack>
      <div className={stylex.props(styles.rowAction).className}>{action}</div>
    </li>
  );
}

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
  const t = useT();
  const importInput = useRef<HTMLInputElement>(null);

  const exportBackup = async () => {
    setError(null);
    try {
      downloadText(exportData(await exportBackupData(), new Date()), "application/json", backupFileName(new Date()));
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Unable to export backup."));
    }
  };

  const exportCsv = async () => {
    setError(null);
    try {
      downloadText(cardsCsv(await getAllCards()), "text/csv;charset=utf-8", cardsCsvFileName(new Date()));
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Unable to export CSV."));
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
      const confirmText = signedIn
        ? t(
            "Importing this backup will replace all local data on this device. Your next sync merges it with your account, so cards and progress already in your account stay. Continue?",
          )
        : t("Importing this backup will replace all local data on this device. Continue?");
      if (!window.confirm(confirmText)) {
        return;
      }
      await replaceAll(data);
      await onImported();
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Unable to import backup."));
    }
  };

  return (
    <ul className={stylex.props(styles.rows).className}>
      <Row
        title={t("Backup file")}
        description={t("Saves your cards, progress and lessons.")}
        action={<Button label={t("Export")} variant="secondary" onClick={() => void exportBackup()} />}
      />
      <Row
        title={t("Cards for a spreadsheet")}
        description={t("Saves your cards as a CSV file.")}
        action={<Button label={t("Export CSV")} variant="secondary" onClick={() => void exportCsv()} />}
      />
      <Row
        title={t("Restore a backup")}
        description={t("Replaces the data on this device with a backup file.")}
        action={(
          <>
            <Button label={t("Import")} variant="secondary" onClick={() => importInput.current?.click()} />
            <input
              ref={importInput}
              className={stylex.props(styles.backupFileInput).className}
              type="file"
              accept="application/json"
              aria-label={t("Import backup file")}
              onChange={(event) => void importBackup(event)}
            />
          </>
        )}
      />
    </ul>
  );
}
