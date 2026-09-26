import * as stylex from "@stylexjs/stylex";

// Styles used by more than one module; a style used by one component lives beside it.
export const sharedStyles = stylex.create({
  sentence: {
    padding: "var(--spacing-4)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-surface)",
  },
  error: {
    color: "var(--color-error)",
  },
  shadowingControls: {
    flexWrap: "wrap",
  },
  viewToggle: {
    alignSelf: "start",
  },
  dictationInput: {
    width: "100%",
    minHeight: "var(--size-element-lg)",
    padding: "var(--spacing-2) var(--spacing-3)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-surface)",
    color: "var(--color-text-primary)",
    font: "inherit",
  },
});
