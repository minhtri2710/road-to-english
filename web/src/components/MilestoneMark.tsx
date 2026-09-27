import * as stylex from "@stylexjs/stylex";

const celebrate = stylex.keyframes({
  "0%": { transform: "scale(0.65)", opacity: 0, boxShadow: "0 0 0 0 var(--color-success-muted)" },
  "24%": { transform: "scale(1)", opacity: 1, boxShadow: "0 0 0 8px transparent" },
  "100%": { transform: "scale(1)", opacity: 1, boxShadow: "0 0 0 8px transparent" },
});

const styles = stylex.create({
  mark: {
    display: "inline-grid",
    width: "1.5em",
    height: "1.5em",
    marginInlineEnd: "var(--spacing-0-5)",
    placeItems: "center",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--color-success-muted)",
    color: "var(--color-success)",
    verticalAlign: "middle",
    animationName: celebrate,
    animationDuration: "var(--duration-slow)",
    animationTimingFunction: "var(--ease-standard)",
    animationIterationCount: 1,
  },
});

export function MilestoneMark() {
  return (
    <span aria-hidden="true" data-motion="milestone" className={stylex.props(styles.mark).className}>
      <svg viewBox="0 0 16 16" width="100%" height="100%" focusable="false">
        <path d="m3 8 3 3 7-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      </svg>
    </span>
  );
}
