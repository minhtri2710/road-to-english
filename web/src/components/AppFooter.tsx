import * as stylex from "@stylexjs/stylex";

import { useT } from "../i18n";
import { routeHash, type Route } from "../lib/route";

const styles = stylex.create({
  footer: {
    borderTop: "1px solid var(--color-border)",
  },
  inner: {
    width: "100%",
    maxWidth: "72rem",
    marginInline: "auto",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--spacing-2) var(--spacing-6)",
    padding: { default: "var(--spacing-6)", "@media (max-width: 480px)": "var(--spacing-4)" },
    color: "var(--color-text-secondary)",
  },
  name: {
    color: "var(--color-text-primary)",
    fontWeight: "var(--font-weight-bold)",
  },
  links: {
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--spacing-1) var(--spacing-4)",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  link: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "var(--size-element-md)",
    color: "var(--color-text-secondary)",
    ":hover": { color: "var(--color-text-primary)" },
    ":focus-visible": { outline: "2px solid var(--focus-outline-color)", outlineOffset: 2, borderRadius: "var(--radius-inner)" },
  },
});

const LINKS: { label: string; route: Route }[] = [
  { label: "How it works", route: { view: "about" } },
  { label: "Lesson library", route: { view: "library" } },
  { label: "Review deck", route: { view: "review" } },
  { label: "Data and backups", route: { view: "manage" } },
];

export function AppFooter({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const t = useT();
  return (
    <footer className={stylex.props(styles.footer).className}>
      <div className={stylex.props(styles.inner).className}>
        <span className={stylex.props(styles.name).className}>Road to English</span>
        <nav aria-label={t("Site")}>
          <ul className={stylex.props(styles.links).className}>
            {LINKS.map(({ label, route }) => (
              <li key={label}>
                <a
                  href={routeHash(route)}
                  className={stylex.props(styles.link).className}
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    onNavigate(route);
                  }}
                >
                  {t(label)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <span>{t("Pre-launch: data may be reset.")}</span>
      </div>
    </footer>
  );
}
