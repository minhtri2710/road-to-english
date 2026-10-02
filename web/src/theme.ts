import { defineTheme } from "@astryxdesign/core/theme";
import type { TokenValue } from "@astryxdesign/core/theme";

// Shadowly design system: warm paper ground, teal for listening, orange for speaking.
export const themePalette = {
  body: ["#F6F4EF", "#101317"],
  surface: ["#FFFFFF", "#181C22"],
  text: ["#15181D", "#EEF0F2"],
  accent: ["#0B6E78", "#4FC3CC"],
  onAccent: ["#FFFFFF", "#101317"],
  speak: ["#C2410C", "#FF8A4C"],
  speakMuted: ["#FEF0E6", "#40220F"],
  success: ["#1D7A3B", "#5FD38A"],
  onSuccess: ["#FFFFFF", "#101317"],
  successMuted: ["#DDF0E2", "#16301F"],
  warning: ["#855600", "#F2C14E"],
  onWarning: ["#FFFFFF", "#101317"],
  warningMuted: ["#FBEFD6", "#3A2E12"],
  error: ["#B42318", "#FF7A6E"],
  onError: ["#FFFFFF", "#101317"],
  errorMuted: ["#FDE7E4", "#45201C"],
  levels: {
    a1: ["#166534", "#86EFAC"],
    a2: ["#1D4ED8", "#93C5FD"],
    b1: ["#92400E", "#FCD34D"],
    b2: ["#6B21A8", "#D8B4FE"],
  },
} as const;

const pair = (value: readonly [string, string]): TokenValue => [value[0], value[1]];

export const projectTheme = defineTheme({
  name: "road-to-english",
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: {
      family: "Be Vietnam Pro",
      fallbacks: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      weight: "normal",
    },
    heading: {
      weight: "bold",
    },
  },
  motion: {
    fast: 120,
    medium: 200,
    slow: 320,
    ratio: 0.75,
    easing: "cubic-bezier(0.2, 0, 0, 1)",
  },
  radius: { base: 5, multiplier: 1 },
  localTokens: {
    "--rte-color-level-a1": pair(themePalette.levels.a1),
    "--rte-color-level-a2": pair(themePalette.levels.a2),
    "--rte-color-level-b1": pair(themePalette.levels.b1),
    "--rte-color-level-b2": pair(themePalette.levels.b2),
    "--rte-color-speak": pair(themePalette.speak),
    "--rte-color-speak-muted": pair(themePalette.speakMuted),
    "--rte-text-reading-size": "1.25rem",
    "--rte-text-reading-leading": "1.5",
    "--rte-ease-emphasized": "cubic-bezier(0.2, 0.8, 0.2, 1)",
  },
  tokens: {
    "--color-background-body": pair(themePalette.body),
    "--color-background-surface": pair(themePalette.surface),
    "--color-background-card": pair(themePalette.surface),
    "--color-background-popover": pair(themePalette.surface),
    "--color-background-muted": ["#ECE9E1", "#22272E"],
    "--color-text-primary": pair(themePalette.text),
    "--color-text-secondary": ["#575D67", "#B8BEC6"],
    "--color-icon-primary": pair(themePalette.text),
    "--color-icon-secondary": ["#575D67", "#B8BEC6"],
    "--font-weight-medium": "600",
    "--font-weight-bold": "700",
    "--color-accent": pair(themePalette.accent),
    "--color-accent-muted": ["#D4ECEE", "#123A3E"],
    "--color-text-accent": pair(themePalette.accent),
    "--color-icon-accent": pair(themePalette.accent),
    "--color-on-accent": pair(themePalette.onAccent),
    "--color-overlay-pressed": ["#E2DED3", "#2B3139"],
    "--focus-outline-color": "var(--color-accent)",
    "--color-success": pair(themePalette.success),
    "--color-on-success": pair(themePalette.onSuccess),
    "--color-success-muted": pair(themePalette.successMuted),
    "--color-warning": pair(themePalette.warning),
    "--color-on-warning": pair(themePalette.onWarning),
    "--color-warning-muted": pair(themePalette.warningMuted),
    "--color-error": pair(themePalette.error),
    "--color-on-error": pair(themePalette.onError),
    "--color-error-muted": pair(themePalette.errorMuted),
    "--color-border": ["#D6D1C5", "#323941"],
    "--color-border-emphasized": ["#8B8F96", "#6B737D"],
    "--color-shadow": ["rgba(21, 24, 29, 0.10)", "rgba(0, 0, 0, 0.40)"],
    "--shadow-low": "0 1px 2px light-dark(rgba(21, 24, 29, 0.06), rgba(0, 0, 0, 0.40)), 0 4px 12px light-dark(rgba(21, 24, 29, 0.06), rgba(0, 0, 0, 0))",
    "--shadow-med": "0 2px 4px light-dark(rgba(21, 24, 29, 0.08), rgba(0, 0, 0, 0.40)), 0 8px 24px light-dark(rgba(21, 24, 29, 0.10), rgba(0, 0, 0, 0.40))",
    "--shadow-high": "0 8px 28px light-dark(rgba(21, 24, 29, 0.16), rgba(0, 0, 0, 0.55))",
    "--radius-inner": "6px",
    "--radius-element": "10px",
    "--radius-container": "16px",
  },
  components: {
    "segmented-control": {
      base: { padding: "var(--spacing-1)" },
    },
    "segmented-control-item": {
      "size:sm": { height: "calc(var(--size-element-sm) - 8px)" },
      "size:md": { height: "calc(var(--size-element-md) - 8px)" },
      "size:lg": { height: "calc(var(--size-element-lg) - 8px)" },
    },
    card: {
      base: { padding: "var(--spacing-3)" },
    },
    section: {
      base: { padding: "var(--spacing-3)" },
    },
    badge: {
      "variant:info": {
        backgroundColor: "var(--color-background-blue)",
        color: "var(--color-text-blue)",
      },
    },
    text: {
      "type:reading": {
        fontSize: "var(--rte-text-reading-size)",
        lineHeight: "var(--rte-text-reading-leading)",
      },
    },
    "toggle-button": {
      "isPressed:true": {
        backgroundColor: "var(--color-accent)",
        color: "var(--color-on-accent)",
      },
    },
    banner: {
      "status:info": {
        "--color-accent": "var(--color-text-blue)",
        "--color-text-primary": "var(--color-text-blue)",
        "--color-text-secondary": "var(--color-text-blue)",
        "--color-accent-muted": "var(--color-background-blue)",
      },
    },
  },
});

declare module "@astryxdesign/core/theme" {
  interface CustomTextTypes {
    reading: true;
  }
}
