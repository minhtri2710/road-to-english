import * as stylex from "@stylexjs/stylex";

// Styles used by more than one module; a style used by one component lives beside it.
export const sharedStyles = stylex.create({
  sentence: {
    padding: { default: "var(--spacing-5)", "@media (max-width: 480px)": "var(--spacing-4)" },
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--color-border)",
    borderRadius: "var(--radius-container)",
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
  // A section's small uppercase label above its title, as on the design's sections. Phones skip it, keeping
  // the first screen for lessons.
  eyebrow: {
    display: { default: "block", "@media (max-width: 480px)": "none" },
    margin: 0,
    color: "var(--color-accent)",
    fontSize: "var(--text-supporting-size)",
    lineHeight: "var(--text-supporting-leading)",
    fontWeight: "var(--font-weight-bold)",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  speakEyebrow: {
    color: "var(--rte-color-speak)",
  },
  // Every view's h1 at the design's heading-1 (32/40) from tablet width; phones keep the theme's h1.
  pageTitle: {
    fontSize: { default: null, "@media (min-width: 481px)": "2rem" },
    lineHeight: { default: null, "@media (min-width: 481px)": 1.25 },
    letterSpacing: { default: null, "@media (min-width: 481px)": "-0.01em" },
  },
  // The library's hero title at the design's display size (48/52).
  heroTitle: {
    fontSize: { default: null, "@media (min-width: 481px)": "3rem" },
    lineHeight: { default: null, "@media (min-width: 481px)": 1.0833 },
    letterSpacing: { default: null, "@media (min-width: 481px)": "-0.02em" },
  },
  // A view's intro line under its title: regular weight, muted, as the design's lead paragraphs.
  lead: {
    maxWidth: "36rem",
    color: "var(--color-text-secondary)",
    fontWeight: "var(--font-weight-normal)",
  },
  // A section of a page set apart as a card, like the library's Today card.
  panel: {
    minWidth: 0,
    padding: { default: "var(--spacing-5)", "@media (max-width: 480px)": "var(--spacing-3)" },
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--color-border)",
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-surface)",
  },
  // From tablet width, a section title at the design's 32px.
  sectionTitle: {
    fontSize: { default: null, "@media (min-width: 481px)": "2rem" },
    lineHeight: { default: null, "@media (min-width: 481px)": 1.25 },
    letterSpacing: { default: null, "@media (min-width: 481px)": "-0.01em" },
  },
  dictationInput: {
    width: "100%",
    minHeight: "var(--size-element-lg)",
    padding: "var(--spacing-2) var(--spacing-3)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--color-border)",
    borderRadius: "var(--radius-element)",
    // The page's color, so a field stands out on the white cards and panels it sits in.
    backgroundColor: "var(--color-background-body)",
    color: "var(--color-text-primary)",
    font: "inherit",
  },
});
