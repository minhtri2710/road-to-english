import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { createLesson, expect, menuItem, openLibraryLesson, test, TRANSCRIPT } from "./fixtures";

const LESSON = "Greetings & Basics";
const FIRST = "Good morning, how are you today?";

async function axe(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`));
}

async function say(page: Page, transcript: string): Promise<void> {
  await page.evaluate((text) => {
    (window as unknown as { __speechTranscript: string }).__speechTranscript = text;
  }, transcript);
}

async function openGuided(page: Page, { pronunciation }: { pronunciation: boolean }): Promise<void> {
  await openLibraryLesson(page, LESSON);
  if (pronunciation) {
    await (await menuItem(page, "Pronunciation check")).click();
    await page.getByRole("button", { name: "Enable" }).click();
  }
  await (await menuItem(page, "One at a time")).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 2, name: "Sentence 1 of 9" })).toBeVisible();
}

const gate = (page: Page) => page.getByRole("region", { name: "Shadow Gate" });
const next = (page: Page) => page.getByRole("button", { name: "Next", exact: true });

test.describe("Learn mode", () => {
  test("needs Pronunciation check, and says so", async ({ page }) => {
    await openGuided(page, { pronunciation: false });
    await expect(page.getByText("Turn on Pronunciation check in Display to use it.")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Learn" })).toBeDisabled();
    await expect(gate(page)).toHaveCount(0);
  });

  test("locks Next until the sentence scores 70, and scores each word", async ({ page }) => {
    await openGuided(page, { pronunciation: true });
    await page.getByRole("radio", { name: "Learn" }).click();
    await expect(gate(page)).toBeVisible();
    await expect(next(page)).toBeDisabled();
    // The card's own check gives way to the gate's speak button.
    await expect(page.getByRole("button", { name: "Check pronunciation" })).toHaveCount(0);

    await say(page, "good morning");
    await gate(page).getByRole("button", { name: "Say the sentence" }).click();
    await expect(gate(page).getByRole("img", { name: "Score 33 of 100" })).toBeVisible();
    await expect(gate(page).getByText("Not yet · 33 points")).toBeVisible();
    await expect(gate(page).getByText("today (missed)")).toBeAttached();
    await expect(next(page)).toBeDisabled();
    expect(await axe(page)).toEqual([]);

    await gate(page).getByRole("button", { name: "Try again" }).click();
    await expect(gate(page).getByRole("button", { name: "Say the sentence" })).toBeFocused();
    await say(page, "good morning how are you today");
    await gate(page).getByRole("button", { name: "Say the sentence" }).click();
    await expect(gate(page).getByText("Unlocked · 100 points")).toBeVisible();
    await expect(next(page)).toBeEnabled();
    await next(page).click();
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 2 of 9" })).toBeFocused();
    await expect(next(page)).toBeDisabled();

    // Going back keeps the first sentence unlocked for this visit.
    await page.getByRole("button", { name: "Previous" }).click();
    await expect(gate(page).getByText("Unlocked", { exact: true })).toBeVisible();
    await expect(next(page)).toBeEnabled();
  });

  test("allows three skips per lesson", async ({ page }) => {
    await openGuided(page, { pronunciation: true });
    await page.getByRole("radio", { name: "Learn" }).click();
    for (const [left, sentence] of [[3, 2], [2, 3], [1, 4]] as const) {
      await page.getByRole("button", { name: `Skip (${left} of 3 left)` }).click();
      await expect(page.getByRole("heading", { level: 2, name: `Sentence ${sentence} of 9` })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Skip (0 of 3 left)" })).toBeDisabled();
    await expect(next(page)).toBeDisabled();
  });

  test("keyboard shortcuts act inside the guided view only", async ({ page }) => {
    await openGuided(page, { pronunciation: true });
    await page.getByRole("radio", { name: "Learn" }).click();
    await say(page, FIRST);
    await page.getByRole("heading", { level: 2, name: "Sentence 1 of 9" }).focus();

    await page.keyboard.press("l");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toContain(FIRST);
    await page.keyboard.press("r");
    await expect(gate(page).getByText("Unlocked · 100 points")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 2 of 9" })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 1 of 9" })).toBeVisible();

    // Outside the guided view the same key does nothing.
    await page.getByRole("button", { name: "Back to lessons" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 1 of 9" })).toBeVisible();
  });
});

test("a played video clip is captioned under the player and its sentence is marked", async ({ page }) => {
  await createLesson(page, { title: "Captioned video", text: TRANSCRIPT, videoUrl: "https://youtu.be/dQw4w9WgXcQ" });
  const clips = page.getByRole("button", { name: "Play clip" });
  await expect(clips.nth(1)).toBeEnabled();
  await expect(page.getByTestId("video-caption")).toHaveCount(0);
  await clips.nth(1).click();
  await expect(page.getByTestId("video-caption")).toHaveText("This is the second line.");
  await expect(page.locator("[data-active]")).toHaveCount(1);
  await expect(page.locator("[data-active]")).toContainText("This is the second line.");
});

test.describe("How it works page", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`has no axe violations in ${colorScheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/#/about");
      await expect(page.getByRole("heading", { level: 1, name: "Listen. Say it back. Level up." })).toBeVisible();
      await expect(page.getByRole("button", { name: "About Me" })).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });
  }

  test("is reached from the footer and starts practice in the library", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "How it works" }).click();
    await expect(page).toHaveURL(/#\/about$/);
    await expect(page.getByRole("heading", { level: 1, name: "Listen. Say it back. Level up." })).toBeFocused();
    await page.getByRole("button", { name: "Start practising" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Lesson library" })).toBeVisible();
  });

  test("fits a 320px screen at 200% text", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/#/about");
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});
