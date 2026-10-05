import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { useT } from "../i18n";
import { BackupControls } from "./BackupControls";

const styles = stylex.create({
  // The storage note as a callout under the rows; a warning tint when the browser may clear data.
  storage: {
    marginBlockStart: "var(--spacing-2)",
    padding: "var(--spacing-2) var(--spacing-3)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-success-muted)",
  },
  storageAtRisk: {
    backgroundColor: "var(--color-warning-muted)",
  },
});

// The return-focus id the Your data heading takes, like a lesson row takes its lesson id.
export const YOUR_DATA = "your-data";

export function YourData({
  storageKept,
  signedIn,
  setError,
  onImported,
  takeReturnFocus,
}: {
  storageKept: boolean | null;
  signedIn: boolean;
  setError: (message: string | null) => void;
  onImported: () => Promise<void>;
  takeReturnFocus: (id: string) => boolean;
}) {
  const t = useT();
  return (
    <VStack as="section" gap={1} aria-labelledby={YOUR_DATA}>
      <Heading
        id={YOUR_DATA}
        level={2}
        tabIndex={-1}
        ref={(heading) => {
          if (heading && takeReturnFocus(YOUR_DATA)) {
            heading.focus();
          }
        }}
      >
        {t("Your data")}
      </Heading>
      <Text as="p" type="supporting">
        {t("Everything you practise stays on this device. Back it up or move it here.")}
      </Text>
      <BackupControls signedIn={signedIn} setError={setError} onImported={onImported} />
      {storageKept !== null && (
        <Text as="p" type="supporting" xstyle={[styles.storage, !storageKept && styles.storageAtRisk]}>
          {storageKept
            ? t("Storage: kept on this device.")
            : t("This browser may clear your saved progress when space is low. Export a backup or sign in to keep it.")}
        </Text>
      )}
    </VStack>
  );
}
