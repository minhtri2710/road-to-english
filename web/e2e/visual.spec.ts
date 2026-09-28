// Visual baselines target chromium-darwin; update intentionally with `pnpm -C web e2e --update-snapshots`.
// When CI runs on another OS, generate that OS's baselines there and remove this darwin-only constraint.

import { expect, openLibraryLesson, test, viewLink } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXED_TIME = new Date("2026-09-29T12:00:00.000Z");
// Default threshold 0.2 misses a card surface turning body-colored.
const SCREENSHOT_OPTIONS = { animations: "disabled" as const, caret: "hide" as const, threshold: 0 };
const LIBRARY_LESSON = "Greetings & Basics";

const PRESENTATIONS = [
  { name: "1280-light", viewport: { width: 1280, height: 900 }, colorScheme: "light" as const },
  { name: "1280-dark", viewport: { width: 1280, height: 900 }, colorScheme: "dark" as const },
  { name: "360-light", viewport: { width: 360, height: 740 }, colorScheme: "light" as const },
] as const;

test.use({ timezoneId: "UTC" });

async function startScreen(page: Page): Promise<void> {
  await page.clock.install({ time: FIXED_TIME });
}

async function capture(page: Page, name: string): Promise<void> {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page).toHaveScreenshot(name, SCREENSHOT_OPTIONS);
}

async function saveReviewCards(page: Page, words: string[]): Promise<void> {
  await openLibraryLesson(page, LIBRARY_LESSON);
  for (const word of words) {
    await page.getByRole("button", { name: word, exact: true }).click();
    await page.getByRole("button", { name: "Save word" }).click();
    await expect(page.getByRole("button", { name: "Saved, remove from review deck" })).toBeVisible();
  }
  await viewLink(page, "Review").click();
  await expect(page.getByText(`${words.length} due`)).toBeVisible();
}

for (const presentation of PRESENTATIONS) {
  test.describe(presentation.name, () => {
    test.use({ viewport: presentation.viewport, colorScheme: presentation.colorScheme });

    test("Library top shows Today and the first lessons", async ({ page }) => {
      await startScreen(page);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
      await expect(page.getByText("Start a new streak today")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Library lessons" })).toBeVisible();
      await expect(page.getByRole("button", { name: "About Me" })).toBeVisible();
      await expect(page.getByRole("button", { name: LIBRARY_LESSON })).toBeVisible();
      await capture(page, `library-top-${presentation.name}.png`);
    });

    test("Lesson practice shows its first sentence and toolbar", async ({ page }) => {
      await startScreen(page);
      await openLibraryLesson(page, LIBRARY_LESSON);
      await expect(page.getByRole("radiogroup", { name: "Lesson mode" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Display" })).toBeVisible();
      await expect(page.getByText("Good morning, how are you today?", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Listen" }).first()).toBeVisible();
      await capture(page, `lesson-practice-${presentation.name}.png`);
    });

    test("Review card front keeps its answer hidden", async ({ page }) => {
      await startScreen(page);
      await saveReviewCards(page, ["morning"]);
      await expect(page.getByRole("heading", { name: "Review deck" })).toBeVisible();
      await expect(page.getByText("1 due")).toBeVisible();
      await expect(page.getByText("morning", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Show answer" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Good" })).toHaveCount(0);
      await capture(page, `review-front-${presentation.name}.png`);
    });

    test("Review revealed shows rating buttons and intervals", async ({ page }) => {
      await startScreen(page);
      await saveReviewCards(page, ["morning"]);
      await page.getByRole("button", { name: "Show answer" }).click();
      await expect(page.getByText("Good morning, how are you today?")).toBeVisible();
      for (const rating of ["Again", "Hard", "Good", "Easy"]) {
        const button = page.getByRole("button", { name: rating, exact: true });
        await expect(button).toBeVisible();
        const intervalId = await button.getAttribute("aria-describedby");
        expect(intervalId).not.toBeNull();
        await expect(page.locator(`[id="${intervalId}"]`)).not.toBeEmpty();
      }
      await capture(page, `review-revealed-${presentation.name}.png`);
    });

    test("Review session summary includes a Rated Again item", async ({ page }) => {
      await startScreen(page);
      await saveReviewCards(page, ["morning", "today"]);
      const firstCard = page.locator("[data-review-card]");
      await expect(firstCard).toContainText("morning");
      const ratedAgainText = "morning";
      await page.getByRole("button", { name: "Show answer" }).click();
      await page.getByRole("button", { name: "Again", exact: true }).click();
      await expect(page.getByText("1 due")).toBeVisible();
      await page.getByRole("button", { name: "Show answer" }).click();
      await page.getByRole("button", { name: "Good", exact: true }).click();
      await expect(page.getByText("0 due")).toBeVisible();
      await expect(page.getByRole("list", { name: "Session rating breakdown" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Rated Again" })).toBeVisible();
      await expect(page.getByRole("listitem").filter({ hasText: ratedAgainText })).toBeVisible();
      await capture(page, `review-summary-${presentation.name}.png`);
    });

    test("Manage shows Import text and Your data", async ({ page }) => {
      await startScreen(page);
      await page.goto("/#/manage");
      await expect(page.getByRole("heading", { level: 1, name: "Manage lessons and data" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Import text" })).toBeVisible();
      await expect(page.getByLabel("Title")).toBeVisible();
      await expect(page.getByLabel("Text", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Your data" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
      await capture(page, `manage-${presentation.name}.png`);
    });
  });
}
