import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { BackupControls } from "./BackupControls";

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
  return (
    <VStack as="section" gap={2} aria-labelledby={YOUR_DATA}>
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
        Your data
      </Heading>
      <Text as="p" type="supporting">
        Export saves a backup file of your cards, progress and lessons. Export CSV saves your cards for a
        spreadsheet. Import replaces the data on this device with a backup file.
      </Text>
      <BackupControls signedIn={signedIn} setError={setError} onImported={onImported} />
      {storageKept !== null && (
        <Text as="p" type="supporting">
          {storageKept
            ? "Storage: kept on this device."
            : "This browser may clear your saved progress when space is low. Export a backup or sign in to keep it."}
        </Text>
      )}
    </VStack>
  );
}
