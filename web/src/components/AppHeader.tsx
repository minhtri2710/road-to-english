import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { AuthState } from "../hooks/auth";
import type { SyncLine } from "../hooks/useSync";
import { AccountArea } from "./AccountArea";
import { Alert, Status } from "./feedback";
import { sharedStyles } from "./styles";

const appStyles = stylex.create({
  header: {
    marginBottom: { default: "var(--spacing-8)", "@media (max-width: 480px)": 0 },
  },
});

export function AppHeader({
  goalAnnounced,
  storageKept,
  storageError,
  backupError,
  syncLine,
  auth,
  onBackUp,
}: {
  goalAnnounced: boolean;
  storageKept: boolean | null;
  storageError: Error | null;
  backupError: string | null;
  syncLine: SyncLine | null;
  auth: AuthState;
  onBackUp: () => void;
}) {
  return (
    <VStack as="header" gap={1} xstyle={appStyles.header}>
      {/* Only reaching the goal is announced; the count lives in the library's Today card. */}
      <Status>
        {goalAnnounced && <Text type="supporting">Daily goal met.</Text>}
      </Status>
      {storageKept === false && (
        <Banner
          status="info"
          title="Progress saved only in this browser"
          endContent={
            <Button label="Back up" variant="secondary" onClick={onBackUp} />
          }
        />
      )}
      {storageError && (
        <Alert>
          Your saved data couldn't be read or saved on this device: {storageError.message}. Reload to try again.
        </Alert>
      )}
      {backupError && <Alert>Backup error: {backupError}</Alert>}
      {/* The synced line changes every minute, so the live region carries only problems and one "Synced." after a failure. */}
      <Status>
        {syncLine?.status === "ownerMismatch" || syncLine?.status === "tooLarge" ? (
          <Text as="p" color="primary" xstyle={sharedStyles.error}>
            {syncLine.text}
          </Text>
        ) : (
          syncLine && syncLine.status !== "synced" && <Text as="p" type="supporting">{syncLine.text}</Text>
        )}
        {syncLine?.recovered && <VisuallyHidden>Synced.</VisuallyHidden>}
      </Status>
      {syncLine?.status === "synced" && <Text as="p" type="supporting">{syncLine.text}</Text>}
      <AccountArea auth={auth} />
    </VStack>
  );
}
