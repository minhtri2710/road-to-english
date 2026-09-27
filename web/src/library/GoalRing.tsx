import * as stylex from "@stylexjs/stylex";

const CIRCUMFERENCE = 2 * Math.PI * 20;

const styles = stylex.create({
  progress: {
    transitionProperty: "stroke-dashoffset",
    transitionDuration: "var(--duration-medium)",
    transitionTimingFunction: "var(--ease-standard)",
  },
  ring: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    flex: "0 0 auto",
    width: "2.75rem",
    height: "2.75rem",
  },
  svg: {
    width: "100%",
    height: "100%",
    transform: "rotate(-90deg)",
  },
  count: {
    position: "absolute",
    fontWeight: "var(--font-weight-semibold)",
    fontVariantNumeric: "tabular-nums",
  },
});

export function GoalRing({
  label,
  value,
  max,
  goalMet,
}: {
  label: string;
  value: number;
  max: number;
  goalMet: boolean;
}) {
  const progress = max > 0 ? Math.min(Math.max(value, 0), max) / max : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(Math.max(value, 0), max)}
      className={stylex.props(styles.ring).className}
    >
      <svg viewBox="0 0 48 48" aria-hidden="true" className={stylex.props(styles.svg).className}>
        <circle cx="24" cy="24" r="20" fill="none" stroke="var(--color-background-muted)" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r="20"
          fill="none"
          stroke={goalMet ? "var(--color-success)" : "var(--color-accent)"}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
          className={stylex.props(styles.progress).className}
        />
      </svg>
      <span aria-hidden="true" className={stylex.props(styles.count).className}>{value}</span>
    </div>
  );
}
