import { Button } from "@astryxdesign/core/Button";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import * as stylex from "@stylexjs/stylex";

import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";

const appStyles = stylex.create({
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: "2rem",
    backgroundColor: "var(--color-background-body)",
    color: "var(--color-text-primary)",
  },
  card: {
    display: "grid",
    gap: "1rem",
    maxWidth: "32rem",
    padding: "2rem",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-surface)",
  },
});

export function App() {
  return (
    <Theme theme={neutralTheme}>
      <main className={stylex.props(appStyles.page).className}>
        <section className={stylex.props(appStyles.card).className}>
          <h1>Road to English</h1>
          <p>A clean starting point for your English learning journey.</p>
          <Button label="Get started" variant="primary" />
        </section>
      </main>
    </Theme>
  );
}
