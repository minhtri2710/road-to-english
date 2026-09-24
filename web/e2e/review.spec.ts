import type { Page } from "@playwright/test";

import { expect, openLibraryLesson, test } from "./fixtures";

async function saveWords(page: Page, words: string[]): Promise<void> {
  await openLibraryLesson(page, "Greetings & Basics");
  for (const word of words) {
    await page.getByRole("button", { name: word, exact: true }).click();
    await page.getByRole("button", { name: "Save word" }).click();
    await expect(page.getByRole("button", { name: "Saved, remove from review deck" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText(`${words.length} due`)).toBeVisible();
}

const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? "");

const ratingRows = (page: Page) =>
  page.evaluate(() => {
    const rows = new Map<number, number>();
    for (const el of document.querySelectorAll<HTMLElement>("button[aria-keyshortcuts]")) {
      if (/^[1-4]$/.test(el.getAttribute("aria-keyshortcuts") ?? "")) {
        const top = Math.round(el.getBoundingClientRect().top);
        rows.set(top, (rows.get(top) ?? 0) + 1);
      }
    }
    return [...rows.values()];
  });

test("review two due cards with the keyboard only and see the recap", async ({ page }) => {
  await saveWords(page, ["morning", "today"]);

  const showAnswer = page.getByRole("button", { name: "Show answer" });
  for (let step = 0; step < 10 && !(await showAnswer.evaluate((el) => el === document.activeElement)); step += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(showAnswer).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Good" })).toBeVisible();
  expect(await ratingRows(page)).toEqual([4]);
  await page.keyboard.press("3");
  await expect(page.getByText("1 due")).toBeVisible();

  // The first rating moved focus to the next card's prompt, so both keys are the card's shortcuts.
  await expect(showAnswer).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Good" })).toBeVisible();
  await page.keyboard.press("3");

  await expect(page.getByText("0 due")).toBeVisible();
  await expect.poll(() => focusedText(page)).toMatch(/^Reviewed 2 cards: 2 Good\. All caught up\./);
  await expect(page.getByRole("heading", { name: "Rated Again" })).toHaveCount(0);
});

// Every button inside the screen, nothing scrolls sideways, and the ratings form one row of four or a 2x2 grid.
const overflow = (page: Page) =>
  page.evaluate(() => {
    const width = window.innerWidth;
    const problems: string[] = [];
    if (document.documentElement.scrollWidth > width) {
      problems.push(`page scrolls horizontally: ${document.documentElement.scrollWidth} > ${width}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>("button")) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && (rect.left < 0 || rect.right > width)) {
        problems.push(`clipped: ${el.textContent?.trim()} [${Math.round(rect.left)}, ${Math.round(rect.right)}]`);
      }
      if (el.scrollWidth > el.clientWidth) {
        problems.push(`overflows: ${el.textContent?.trim()}`);
      }
    }
    return problems;
  });

for (const width of [360, 320]) {
  test.describe(`${width} px wide`, () => {
    test.use({ viewport: { width, height: 740 } });

    test("the rating row and the recap stay inside the screen", async ({ page }, testInfo) => {
      await saveWords(page, ["morning"]);
      await page.getByRole("button", { name: "Show answer" }).click();
      await expect(page.getByRole("button", { name: "Easy" })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`review-rating-${width}.png`), fullPage: true });
      expect(await overflow(page)).toEqual([]);
      expect([[4], [2, 2]]).toContainEqual(await ratingRows(page));

      await page.getByRole("button", { name: "Again" }).click();
      await expect(page.getByRole("heading", { name: "Rated Again" })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`review-recap-${width}.png`), fullPage: true });
      expect(await overflow(page)).toEqual([]);
    });
  });
}
