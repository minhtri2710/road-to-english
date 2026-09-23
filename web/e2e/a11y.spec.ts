import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, openLibraryLesson, test } from "./fixtures";

const LIBRARY_LESSON = "Greetings & Basics";
const USER_LESSON = "My pasted text";
const TRANSCRIPT = "0:00\nHello there, my friend.\n0:07\nThis is the second line.";

async function axeViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`),
  );
}

async function createUserLesson(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Title").fill(USER_LESSON);
  await page.getByLabel("Text", { exact: true }).fill("The first sentence is short. The second one follows.");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 2, name: USER_LESSON })).toBeVisible();
  await page.getByRole("button", { name: "Back to lessons" }).click();
  await expect(page.getByRole("button", { name: `Delete ${USER_LESSON}` })).toBeVisible();
  await expect(page.getByRole("button", { name: LIBRARY_LESSON })).toBeVisible();
}

async function selectWord(page: Page): Promise<void> {
  await openLibraryLesson(page, LIBRARY_LESSON);
  await page.getByRole("button", { name: "morning", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save word" })).toBeVisible();
}

async function openReviewWithDueCard(page: Page): Promise<void> {
  await selectWord(page);
  await page.getByRole("button", { name: "Save word" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toHaveAccessibleName("Saved, remove from review deck");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("1 due")).toBeVisible();
}

async function showImportError(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("button", { name: LIBRARY_LESSON })).toBeVisible();
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(/^Title must be/)).toBeVisible();
}

async function openVideoLesson(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Title").fill("Video lesson");
  await page.getByLabel("YouTube URL").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByLabel("Text", { exact: true }).fill(TRANSCRIPT);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("button", { name: "Play clip" }).first()).toBeEnabled();
}

// Each state is reached through the UI and yields once so the caller can inspect it.
const STATES: [string, (page: Page, inspect: () => Promise<void>) => Promise<void>][] = [
  ["library list with a user lesson", async (page, inspect) => {
    await createUserLesson(page);
    await inspect();
  }],
  ["shadow mode with a word selected", async (page, inspect) => {
    await selectWord(page);
    await inspect();
  }],
  ["dictation mode", async (page, inspect) => {
    await openLibraryLesson(page, LIBRARY_LESSON);
    await page.getByRole("button", { name: "Dictation" }).click();
    await expect(page.getByLabel("What did you hear?").first()).toBeVisible();
    await inspect();
  }],
  ["blank mode", async (page, inspect) => {
    await openLibraryLesson(page, LIBRARY_LESSON);
    await page.getByRole("button", { name: "Fill the blank" }).click();
    await expect(page.getByLabel("Which word fills the blank?").first()).toBeVisible();
    await inspect();
  }],
  ["pronunciation disclosure open", async (page, inspect) => {
    await openLibraryLesson(page, LIBRARY_LESSON);
    await page.getByRole("button", { name: "Pronunciation check" }).click();
    await expect(page.getByRole("button", { name: "Enable" })).toBeVisible();
    await inspect();
  }],
  ["review with a due card", async (page, inspect) => {
    await openReviewWithDueCard(page);
    await inspect();
    await page.getByRole("button", { name: "Show answer" }).click();
    await expect(page.getByRole("button", { name: "Good" })).toBeVisible();
    await inspect();
  }],
  ["import form with a validation error", async (page, inspect) => {
    await showImportError(page);
    await inspect();
  }],
  ["video lesson", async (page, inspect) => {
    await openVideoLesson(page);
    await inspect();
  }],
];

test.describe("axe", () => {
  for (const [name, reach] of STATES) {
    test(name, async ({ page }) => {
      await reach(page, async () => {
        expect(await axeViolations(page)).toEqual([]);
      });
    });
  }
});

async function focusIndicator(page: Page): Promise<{ label: string; visible: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const style = getComputedStyle(el);
    const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
    return {
      label: `${el.tagName} ${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40)}`,
      visible: outline || style.boxShadow !== "none",
    };
  });
}

async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    return el === document.body || el === null
      ? "BODY"
      : `${el.tagName} ${el.getAttribute("aria-label") ?? el.textContent?.trim()}`;
  });
}

// Tabs until the target has focus, asserting every stop on the way shows a focus indicator.
async function tabTo(page: Page, target: ReturnType<Page["getByRole"]>, key = "Tab"): Promise<void> {
  const hidden: string[] = [];
  for (let step = 0; step < 80; step += 1) {
    await page.keyboard.press(key);
    const indicator = await focusIndicator(page);
    if (!indicator.visible) {
      hidden.push(indicator.label);
    }
    if (await target.evaluate((el) => el === document.activeElement)) {
      expect(hidden, "focused controls without a visible focus indicator").toEqual([]);
      return;
    }
  }
  throw new Error("target never received focus");
}

test.describe("keyboard", () => {
  test("open a lesson, listen, save a word, review and rate", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("button", { name: LIBRARY_LESSON });
    await expect(row).toBeVisible();

    await tabTo(page, row);
    await page.keyboard.press("Enter");
    const heading = page.getByRole("heading", { level: 2, name: LIBRARY_LESSON });
    await expect(heading).toBeFocused();
    expect((await focusIndicator(page)).visible).toBe(true);

    await tabTo(page, page.getByRole("button", { name: "morning", exact: true }));
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Hear word" })).toBeVisible();

    await tabTo(page, page.getByRole("button", { name: "Save word" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Saved" })).toHaveAccessibleName("Saved, remove from review deck");
    await expect(page.getByRole("button", { name: "Saved" })).toBeFocused();

    await tabTo(page, page.getByRole("button", { name: "Listen" }).first());
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken))
      .toContain("Good morning, how are you today?");

    const reviewToggle = page.getByRole("button", { name: "Review", exact: true });
    await tabTo(page, reviewToggle, "Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByText("1 due")).toBeVisible();
    await expect(reviewToggle).toBeFocused();

    await tabTo(page, page.getByRole("button", { name: "Show answer" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Good" })).toBeVisible();
    expect(await focusedName(page)).toContain("Good morning, how are you today?");

    await tabTo(page, page.getByRole("button", { name: "Good" }));
    await page.keyboard.press("Enter");
    await expect(page.getByText("0 due")).toBeVisible();
    await expect.poll(() => focusedName(page)).toContain("All caught up");
  });

  test("Back returns focus to the lesson row that opened the lesson", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("button", { name: LIBRARY_LESSON });
    await tabTo(page, row);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: LIBRARY_LESSON })).toBeFocused();

    await tabTo(page, page.getByRole("button", { name: "Back to lessons" }), "Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(row).toBeFocused();
  });
});

// Every drawn text element of the row lies inside the row's box and nothing scrolls.
async function rowOverflow(page: Page, title: string): Promise<string[]> {
  return page.getByRole("button", { name: title, exact: true }).evaluate((button) => {
    const outer = button.getBoundingClientRect();
    return [button, ...button.querySelectorAll<HTMLElement>("*")].flatMap((el) => {
      const rect = el.getBoundingClientRect();
      const problems: string[] = [];
      if (el.scrollWidth > el.clientWidth) {
        problems.push(`${el.tagName} scrolls: ${el.scrollWidth} > ${el.clientWidth}`);
      }
      // Astryx's 1px visually hidden span is not drawn text.
      if (el.textContent && rect.height > 1 && (rect.top < outer.top || rect.bottom > outer.bottom || rect.right > outer.right)) {
        problems.push(`${el.tagName} outside the row: ${el.textContent.trim()}`);
      }
      return problems;
    });
  });
}

test("desktop lesson rows keep their meta line inside the row", async ({ page }) => {
  await createUserLesson(page);
  for (const title of [LIBRARY_LESSON, USER_LESSON]) {
    expect(await rowOverflow(page, title), `${title} row`).toEqual([]);
  }
});

async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth > width) {
      problems.push(`page scrolls horizontally: ${document.documentElement.scrollWidth} > ${width}`);
    }
    const controls = document.querySelectorAll<HTMLElement>("button, a[href], input, textarea, select, audio[controls]");
    for (const el of controls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        continue;
      }
      const name = `${el.tagName} ${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)}`;
      if (rect.left < 0 || rect.right > width) {
        problems.push(`clipped: ${name} [${Math.round(rect.left)}, ${Math.round(rect.right)}]`);
      }
      // Words inside a sentence are inline targets, which WCAG 2.5.8 exempts.
      if (!el.closest("p") && (rect.width < 24 || rect.height < 24)) {
        problems.push(`target under 24px: ${name} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth) {
        problems.push(`truncated: ${el.textContent?.trim()}`);
      }
    }
    return problems;
  });
}

const MOBILE_STATES: [string, (page: Page) => Promise<void>][] = [
  ["library", createUserLesson],
  ["lesson in shadow mode with a word selected", selectWord],
  ["review", async (page) => {
    await openReviewWithDueCard(page);
    await page.getByRole("button", { name: "Show answer" }).click();
  }],
  ["import form", showImportError],
];

test.describe("mobile 375x667", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  for (const [name, reach] of MOBILE_STATES) {
    test(name, async ({ page }) => {
      await reach(page);
      expect(await layoutProblems(page)).toEqual([]);
    });
  }

  test("lesson rows keep their text unclipped and Delete at least 24x24", async ({ page }) => {
    await createUserLesson(page);
    for (const title of [LIBRARY_LESSON, USER_LESSON]) {
      expect(await rowOverflow(page, title), `${title} row`).toEqual([]);
    }
    const box = await page.getByRole("button", { name: `Delete ${USER_LESSON}` }).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(24);
    expect(box?.height).toBeGreaterThanOrEqual(24);
  });
});

async function motion(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Deterministic: computed styles, not whatever happens to be running now. Astryx zeroes its
    // Button and ToggleButton motion itself but not Link's 125ms transition, and a Link only renders
    // in some states, so a probe with its own inline motion checks the global rule in every state.
    const found: string[] = [];
    const probe = document.createElement("a");
    probe.className = "astryx-link";
    probe.style.transition = "color 0.125s";
    probe.style.animation = "probe 1s infinite";
    document.body.append(probe);
    for (const [selector, required] of [
      [".astryx-button", true],
      [".astryx-toggle-button", true],
      [".astryx-link", true],
    ] as const) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      if (required && elements.length === 0) {
        found.push(`no ${selector} to inspect`);
      }
      for (const el of elements) {
        const style = getComputedStyle(el);
        const still =
          style.transitionProperty === "none" ||
          style.transitionDuration.split(",").every((value) => parseFloat(value) === 0);
        if (!still || style.animationName !== "none") {
          found.push(`${selector} transition ${style.transitionProperty} ${style.transitionDuration} animation ${style.animationName}`);
        }
      }
    }
    probe.remove();
    found.push(...document
      .getAnimations()
      .filter((animation) => animation.playState === "running")
      .map((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return `running animation ${(animation as CSSAnimation).animationName ?? ""} on ${target?.tagName}.${target?.className}`;
      }));
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      const durations = getComputedStyle(el).transitionDuration.split(",").map((value) => {
        const trimmed = value.trim();
        return trimmed.endsWith("ms") ? parseFloat(trimmed) / 1000 : parseFloat(trimmed);
      });
      if (durations.some((seconds) => seconds > 0.01)) {
        found.push(`transition ${getComputedStyle(el).transitionDuration} on ${el.tagName}.${el.className}`);
      }
    }
    return found;
  });
}

test.describe("reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  for (const [name, reach] of STATES) {
    test(name, async ({ page }) => {
      await reach(page, async () => {
        expect(await motion(page)).toEqual([]);
      });
    });
  }
});
