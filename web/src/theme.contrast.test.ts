import { describe, expect, it } from "vitest";

import { projectTheme, themePalette } from "./theme";

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  };
  const fg = luminance(foreground);
  const bg = luminance(background);
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
}

const backgrounds = {
  body: themePalette.body,
  surface: themePalette.surface,
} as const;

function expectContrast(foreground: readonly [string, string], background: readonly [string, string], minimum: number, name: string) {
  for (const [index, scheme] of ["light", "dark"].entries()) {
    const ratio = contrastRatio(foreground[index], background[index]);
    expect(ratio, `${name} in ${scheme} mode: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(minimum);
  }
}

describe("project theme contrast", () => {
  it("keeps accent text and icons legible on primary actions", () => {
    expectContrast(themePalette.onAccent, themePalette.accent, 4.5, "text on accent");
    expectContrast(themePalette.onAccent, themePalette.accent, 3, "icon on accent");
  });

  it("keeps semantic action text and icons legible on their fills", () => {
    for (const [name, foreground, background] of [
      ["success", themePalette.onSuccess, themePalette.success],
      ["warning", themePalette.onWarning, themePalette.warning],
      ["error", themePalette.onError, themePalette.error],
    ] as const) {
      expectContrast(foreground, background, 4.5, `text on ${name}`);
      expectContrast(foreground, background, 3, `icon on ${name}`);
    }
  });

  it("keeps semantic text colors legible on body and surface backgrounds", () => {
    for (const [name, foreground] of [
      ["success", themePalette.success],
      ["warning", themePalette.warning],
      ["error", themePalette.error],
    ] as const) {
      for (const [surface, background] of Object.entries(backgrounds)) {
        expectContrast(foreground, background, 4.5, `${name} text on ${surface}`);
      }
    }
  });

  it("keeps the accent legible on body and surface backgrounds", () => {
    for (const [name, background] of Object.entries(backgrounds)) {
      expectContrast(themePalette.accent, background, 4.5, `accent text on ${name}`);
      expectContrast(themePalette.accent, background, 3, `accent UI on ${name}`);
    }
  });

  it("keeps every level color legible on the level-card surface", () => {
    for (const [level, color] of Object.entries(themePalette.levels)) {
      expectContrast(color, themePalette.surface, 4.5, `${level} text on surface`);
      expectContrast(color, themePalette.surface, 3, `${level} UI on surface`);
    }
  });

  it("uses a passing text color on the accent for primary buttons", () => {
    expectContrast(themePalette.onAccent, themePalette.accent, 4.5, "primary button foreground");
    expect(projectTheme.tokens["--color-on-accent"]).toContain("#FFFFFF");
  });
});
