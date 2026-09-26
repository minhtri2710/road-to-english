import { useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { AuthState } from "../hooks/auth";
import type { SyncLine } from "../hooks/useSync";
import { routeHash, type Route } from "../lib/route";
import { YOUR_DATA } from "./YourData";
import { AccountArea } from "./AccountArea";
import { Alert, Status } from "./feedback";
import { sharedStyles } from "./styles";

const styles = stylex.create({
  header: {
    marginBottom: 0,
  },
  bar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "var(--spacing-2)",
    padding: "var(--spacing-2) var(--spacing-3)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-surface)",
    boxShadow: "var(--shadow-low)",
  },
  brand: {
    color: "var(--color-text-primary)",
    fontWeight: "var(--font-weight-bold)",
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  nav: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "var(--spacing-1)",
  },
  navLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--spacing-1)",
    minHeight: "var(--size-element-md)",
    paddingInline: "var(--spacing-2)",
    borderRadius: "var(--radius-element)",
    color: "var(--color-text-secondary)",
    fontWeight: "var(--font-weight-medium)",
    textDecoration: "none",
    ":hover": { color: "var(--color-text-primary)", backgroundColor: "var(--color-background-muted)" },
    ":focus-visible": { outline: "2px solid var(--focus-outline-color)", outlineOffset: 2 },
  },
  active: {
    color: "var(--color-accent)",
    backgroundColor: "var(--color-accent-muted)",
  },
  due: {
    backgroundColor: "var(--color-accent)",
    color: "var(--color-on-accent)",
    borderRadius: "var(--radius-full)",
    paddingInline: "var(--spacing-1)",
    fontSize: "var(--text-supporting-size)",
    lineHeight: "var(--text-supporting-leading)",
    fontWeight: "var(--font-weight-medium)",
  },
  status: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "var(--spacing-2)",
    maxWidth: "100%",
    marginInlineStart: "auto",
    padding: "var(--spacing-1) var(--spacing-2)",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--color-accent-muted)",
    color: "var(--color-text-primary)",
  },
  statusBadge: {
    flexShrink: 1,
    minWidth: 0,
  },
  storageText: {
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  account: {
    minWidth: 0,
    flexBasis: { "@media (max-width: 480px)": "100%" },
  },
  accountOpen: {
    flexBasis: "100%",
  },
});

export function AppHeader({
  goalAnnounced,
  storageKept,
  storageError,
  backupError,
  syncLine,
  auth,
  view,
  due,
  onNavigate,
}: {
  goalAnnounced: boolean;
  storageKept: boolean | null;
  storageError: Error | null;
  backupError: string | null;
  syncLine: SyncLine | null;
  auth: AuthState;
  view: Route["view"] | null;
  due: number | null;
  onNavigate: (route: Route, returnTo?: string) => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const navLinks: { label: string; route: Route; selected: boolean }[] = [
    { label: "Library", route: { view: "library" }, selected: view === "library" },
    { label: "Review", route: { view: "review" }, selected: view === "review" },
    { label: "Manage", route: { view: "manage" }, selected: view === "manage" },
  ];
  const syncError = syncLine?.status === "ownerMismatch" || syncLine?.status === "tooLarge";
  const storageNotice = storageKept === false;

  return (
    <VStack as="header" gap={1} xstyle={styles.header}>
      <div className={stylex.props(styles.bar).className}>
        <a
          href={routeHash({ view: "library" })}
          className={stylex.props(styles.brand).className}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onNavigate({ view: "library" });
          }}
        >
          Road to English
        </a>
        <nav aria-label="Views" className={stylex.props(styles.nav).className}>
          {navLinks.map(({ label, route, selected }) => (
            <a
              key={label}
              href={routeHash(route)}
              aria-current={selected ? "page" : undefined}
              aria-label={label === "Review" && due !== null && due > 0 ? `${label}, ${due} due` : undefined}
              className={stylex.props(styles.navLink, selected && styles.active).className}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onNavigate(route);
              }}
            >
              {label}
              {label === "Review" && due !== null && due > 0 && (
                <span aria-hidden="true" className={stylex.props(styles.due).className}>{due}</span>
              )}
            </a>
          ))}
        </nav>
        <div className={stylex.props(styles.account, accountOpen && styles.accountOpen).className}>
          <AccountArea auth={auth} onDisclosureChange={setAccountOpen} />
        </div>
        {storageNotice && (
          <div className={stylex.props(styles.status).className}>
            <Text as="span" type="supporting" xstyle={styles.storageText}>
              Progress saved only in this browser
            </Text>
            <Button label="Back up" variant="secondary" onClick={() => onNavigate({ view: "manage" }, YOUR_DATA)} />
          </div>
        )}
        {syncLine?.status === "synced" && (
          <span className={stylex.props(styles.statusBadge).className}>
            <Badge label={syncLine.text} variant="success" />
          </span>
        )}
      </div>
      <Status>
        {goalAnnounced && <Text type="supporting">Daily goal met.</Text>}
      </Status>
      {storageError && (
        <Alert>
          Your saved data couldn't be read or saved on this device: {storageError.message}. Reload to try again.
        </Alert>
      )}
      {backupError && <Alert>Backup error: {backupError}</Alert>}
      <Status>
        {syncError ? (
          <Text as="p" color="primary" xstyle={sharedStyles.error}>{syncLine.text}</Text>
        ) : (
          syncLine && syncLine.status !== "synced" && <Text as="p" type="supporting">{syncLine.text}</Text>
        )}
        {syncLine?.recovered && <VisuallyHidden>Synced.</VisuallyHidden>}
      </Status>
    </VStack>
  );
}
