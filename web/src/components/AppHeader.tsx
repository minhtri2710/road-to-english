import { useEffect, useRef, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { AuthState } from "../hooks/auth";
import type { SyncLine } from "../hooks/useSync";
import { useT } from "../i18n";
import { routeHash, type Route } from "../lib/route";
import { YOUR_DATA } from "./YourData";
import { AccountArea, AccountError } from "./AccountArea";
import { LanguageSwitch } from "./LanguageSwitch";
import { Alert, OfflineIcon, Status } from "./feedback";
import { MilestoneMark } from "./MilestoneMark";
import { sharedStyles } from "./styles";

const styles = stylex.create({
  header: {
    borderBottom: "1px solid var(--color-border)",
    backgroundColor: "var(--color-background-body)",
  },
  inner: {
    width: "100%",
    maxWidth: "72rem",
    marginInline: "auto",
    padding: { default: "var(--spacing-3) var(--spacing-6)", "@media (max-width: 480px)": "var(--spacing-2) var(--spacing-4)" },
  },
  bar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: { default: "var(--spacing-2) var(--spacing-6)", "@media (max-width: 480px)": "var(--spacing-2)" },
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    minHeight: "var(--size-element-lg)",
    color: "var(--color-text-primary)",
    fontSize: "1.25rem",
    fontWeight: "var(--font-weight-bold)",
    letterSpacing: "-0.01em",
    textDecoration: "none",
    // Enlarged text wraps the name beside its mark instead of scrolling the page.
    minWidth: 0,
    overflowWrap: "anywhere",
    ":focus-visible": { outline: "2px solid var(--focus-outline-color)", outlineOffset: 2, borderRadius: "var(--radius-inner)" },
  },
  // Two listening bars, then two speaking bars: the app's listen-then-speak loop.
  mark: {
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    gap: "3px",
    height: "20px",
  },
  markBar: {
    width: "4px",
    borderRadius: "var(--radius-full)",
  },
  listenBar: {
    backgroundColor: "var(--color-accent)",
  },
  speakBar: {
    backgroundColor: "var(--rte-color-speak)",
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
    minHeight: "var(--size-element-lg)",
    paddingInline: "var(--spacing-3)",
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
    backgroundColor: "var(--rte-color-speak)",
    color: "var(--color-on-accent)",
    borderRadius: "var(--radius-full)",
    paddingInline: "var(--spacing-1-5)",
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
    padding: "var(--spacing-1) var(--spacing-2)",
    borderRadius: { default: "var(--radius-full)", "@media (max-width: 480px)": "var(--radius-container)" },
    backgroundColor: "var(--rte-color-speak-muted)",
    color: "var(--color-text-primary)",
  },
  statusBadge: {
    flexShrink: 1,
    minWidth: 0,
  },
  storageText: {
    flex: "1 1 8rem",
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  storageAction: {
    flexShrink: 0,
  },
  // Storage and sync status, the language switch and the account disclosure share the bar's end.
  account: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: { default: "flex-end", "@media (max-width: 480px)": "flex-start" },
    gap: "var(--spacing-1)",
    minWidth: 0,
    marginInlineStart: "auto",
    flexBasis: { "@media (max-width: 480px)": "100%" },
  },
  accountOpen: {
    flexBasis: "100%",
  },
  accountArea: {
    minWidth: 0,
  },
  // The primary action in the speak color: the button reads its fill from this token. Phones skip it, keeping
  // the first screen for lessons.
  speakButton: {
    display: { default: "contents", "@media (max-width: 480px)": "none" },
    "--color-accent": "var(--rte-color-speak)",
  },
  // The account's error, such as an unreachable server, as a quiet banner under the bar.
  offline: {
    display: "flex",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: "var(--spacing-2)",
    maxWidth: "100%",
    padding: "var(--spacing-1) var(--spacing-3)",
    borderRadius: { default: "var(--radius-full)", "@media (max-width: 480px)": "var(--radius-container)" },
    backgroundColor: "var(--color-background-muted)",
    color: "var(--color-text-secondary)",
  },
  accountAreaOpen: {
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
  cta,
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
  // The header's primary action, as the design's: back to practice. Null where it would lead to this page.
  cta?: { label: string; onClick: () => void } | null;
  onNavigate: (route: Route, returnTo?: string) => void;
}) {
  const t = useT();
  const [accountOpen, setAccountOpen] = useState(false);
  const goalWasAnnounced = useRef(goalAnnounced);
  const [goalEvent, setGoalEvent] = useState(0);

  useEffect(() => {
    if (goalAnnounced && !goalWasAnnounced.current) {
      setGoalEvent((event) => event + 1);
    }
    goalWasAnnounced.current = goalAnnounced;
  }, [goalAnnounced]);
  const navLinks: { label: string; route: Route; selected: boolean }[] = [
    { label: "Library", route: { view: "library" }, selected: view === "library" },
    { label: "Review", route: { view: "review" }, selected: view === "review" },
    { label: "Manage", route: { view: "manage" }, selected: view === "manage" },
  ];
  const syncError = syncLine?.status === "ownerMismatch" || syncLine?.status === "tooLarge";
  const storageNotice = storageKept === false;

  return (
    <header className={stylex.props(styles.header).className}>
      <VStack gap={1} xstyle={styles.inner}>
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
            <span aria-hidden="true" className={stylex.props(styles.mark).className}>
              <span className={stylex.props(styles.markBar, styles.listenBar).className} style={{ height: 10 }} />
              <span className={stylex.props(styles.markBar, styles.listenBar).className} style={{ height: 18 }} />
              <span className={stylex.props(styles.markBar, styles.speakBar).className} style={{ height: 13 }} />
              <span className={stylex.props(styles.markBar, styles.speakBar).className} style={{ height: 7 }} />
            </span>
            Road to English
          </a>
          <nav aria-label={t("Views")} className={stylex.props(styles.nav).className}>
            {navLinks.map(({ label, route, selected }) => (
              <a
                key={label}
                href={routeHash(route)}
                aria-current={selected ? "page" : undefined}
                aria-label={label === "Review" && due !== null && due > 0 ? t("Review, {count} due", { count: due }) : undefined}
                className={stylex.props(styles.navLink, selected && styles.active).className}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onNavigate(route);
                }}
              >
                {t(label)}
                {label === "Review" && due !== null && due > 0 && (
                  <span aria-hidden="true" className={stylex.props(styles.due).className}>{due}</span>
                )}
              </a>
            ))}
          </nav>
          <div className={stylex.props(styles.account, accountOpen && styles.accountOpen).className}>
            {storageNotice && (
              <div className={stylex.props(styles.status).className}>
                <Text as="span" type="supporting" xstyle={styles.storageText}>
                  {t("Progress saved only in this browser")}
                </Text>
                <Button label={t("Back up")} variant="secondary" xstyle={styles.storageAction} onClick={() => onNavigate({ view: "manage" }, YOUR_DATA)} />
              </div>
            )}
            {syncLine?.status === "synced" && (
              <span className={stylex.props(styles.statusBadge).className}>
                <Badge label={syncLine.text} variant="success" />
              </span>
            )}
            <LanguageSwitch />
            <div className={stylex.props(styles.accountArea, accountOpen && styles.accountAreaOpen).className}>
              <AccountArea auth={auth} onDisclosureChange={setAccountOpen} />
            </div>
            {/* The storage chip's Back up takes this place: the bar has no room for both at its widest. */}
            {cta && !accountOpen && !storageNotice && (
              <span className={stylex.props(styles.speakButton).className}>
                <Button label={cta.label} variant="primary" onClick={cta.onClick} />
              </span>
            )}
          </div>
        </div>
        {!auth.user && !accountOpen && auth.error && (
          <div className={stylex.props(styles.offline).className}>
            <OfflineIcon />
            <AccountError error={auth.error} />
          </div>
        )}
        <Status>
          {goalAnnounced && (
            <Text type="supporting">
              {goalEvent > 0 && <MilestoneMark key={goalEvent} />}
              {t("Daily goal met.")}
            </Text>
          )}
        </Status>
        {storageError && (
          <Alert>
            {t("Your saved data couldn't be read or saved on this device: {message}. Reload to try again.", { message: storageError.message })}
          </Alert>
        )}
        {backupError && <Alert>{t("Backup error: {error}", { error: backupError })}</Alert>}
        <Status>
          {syncError ? (
            <Text as="p" color="primary" xstyle={sharedStyles.error}>{syncLine.text}</Text>
          ) : (
            syncLine && syncLine.status !== "synced" && <Text as="p" type="supporting">{syncLine.text}</Text>
          )}
          {syncLine?.recovered && <VisuallyHidden>{t("Synced.")}</VisuallyHidden>}
        </Status>
      </VStack>
    </header>
  );
}
