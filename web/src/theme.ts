import { defineTheme } from "@astryxdesign/core/theme";
import type { TokenValue } from "@astryxdesign/core/theme";

export const themePalette = {
  body: ["#F3F7F6", "#101B1A"],
  surface: ["#FFFFFF", "#182725"],
  text: ["#152523", "#E4F1EE"],
  accent: ["#0F766E", "#5EEAD4"],
  onAccent: ["#FFFFFF", "#063B37"],
  success: ["#166534", "#86EFAC"],
  onSuccess: ["#FFFFFF", "#06351C"],
  successMuted: ["#DCFCE7", "#173B28"],
  warning: ["#854D0E", "#FCD34D"],
  onWarning: ["#FFFFFF", "#422B00"],
  warningMuted: ["#FEF3C7", "#433514"],
  error: ["#B42334", "#FF7A84"],
  onError: ["#FFFFFF", "#45070D"],
  errorMuted: ["#FEE4E2", "#4A2025"],
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
      fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      weight: "normal",
    },
    heading: {
      weight: "semibold",
    },
  },
  motion: {
    fast: 120,
    medium: 200,
    slow: 320,
    ratio: 0.75,
    easing: "cubic-bezier(0.2, 0, 0, 1)",
  },
  radius: { base: 4, multiplier: 1 },
  localTokens: {
    "--rte-color-level-a1": pair(themePalette.levels.a1),
    "--rte-color-level-a2": pair(themePalette.levels.a2),
    "--rte-color-level-b1": pair(themePalette.levels.b1),
    "--rte-color-level-b2": pair(themePalette.levels.b2),
    "--rte-text-reading-size": "1.25rem",
    "--rte-text-reading-leading": "1.5",
    "--rte-ease-emphasized": "cubic-bezier(0.2, 0.8, 0.2, 1)",
  },
  tokens: {
    "--color-background-body": pair(themePalette.body),
    "--color-background-surface": pair(themePalette.surface),
    "--color-background-card": pair(themePalette.surface),
    "--color-background-popover": pair(themePalette.surface),
    "--color-background-muted": ["#E8F0ED", "#253A36"],
    "--color-text-primary": pair(themePalette.text),
    "--color-text-secondary": ["#4A625D", "#B1C7C1"],
    "--color-icon-primary": pair(themePalette.text),
    "--color-icon-secondary": ["#4A625D", "#B1C7C1"],
    "--font-weight-medium": "600",
    "--font-weight-bold": "700",
    "--color-accent": pair(themePalette.accent),
    "--color-accent-muted": ["#CCFBF1", "#16433D"],
    "--color-text-accent": pair(themePalette.accent),
    "--color-icon-accent": pair(themePalette.accent),
    "--color-on-accent": pair(themePalette.onAccent),
    "--color-overlay-pressed": ["#D6E8E3", "#294943"],
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
    "--color-border": ["#D8E3E0", "#344A46"],
    "--color-border-emphasized": ["#9BAEAA", "#617873"],
    "--color-shadow": ["rgba(21, 37, 35, 0.10)", "rgba(0, 0, 0, 0.32)"],
    "--shadow-low": "0 1px 2px light-dark(rgba(21, 37, 35, 0.08), rgba(0, 0, 0, 0.24)), 0 4px 12px light-dark(rgba(21, 37, 35, 0.06), rgba(0, 0, 0, 0.20))",
    "--shadow-med": "0 2px 4px light-dark(rgba(21, 37, 35, 0.10), rgba(0, 0, 0, 0.30)), 0 8px 24px light-dark(rgba(21, 37, 35, 0.08), rgba(0, 0, 0, 0.26))",
    "--shadow-high": "0 4px 8px light-dark(rgba(21, 37, 35, 0.12), rgba(0, 0, 0, 0.34)), 0 16px 32px light-dark(rgba(21, 37, 35, 0.10), rgba(0, 0, 0, 0.30))",
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
