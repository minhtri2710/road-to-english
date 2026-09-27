import type { Page } from "@playwright/test";

import { expect, openLibraryLesson, test } from "./fixtures";

const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

test("recording keeps the practice controls in place", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLibraryLesson(page, "Greetings & Basics");
  const row = page.getByRole("listitem").first();
  const record = row.getByRole("button", { name: "Record" });
  const loop = row.getByRole("button", { name: "Loop" });
  const compare = row.getByRole("button", { name: "Compare" });
  const bounds = async () => Promise.all([loop, record, compare].map(async (button) => {
    const box = await button.boundingBox();
    if (!box) throw new Error("practice control has no bounding box");
    return { left: box.x, right: box.x + box.width };
  }));
  const before = await bounds();
  const beforeGap = before[1]!.left - before[0]!.right;
  expect(beforeGap).toBeGreaterThan(0);
  expect(before[2]!.left - before[1]!.right).toBeCloseTo(beforeGap, 0);
  await expect(compare).toBeDisabled();
  await record.click();
  const stop = row.getByRole("button", { name: "Stop" });
  await expect(stop).toBeVisible();
  const recording = await Promise.all([loop, stop, compare].map(async (button) => {
    const box = await button.boundingBox();
    if (!box) throw new Error("practice control has no bounding box");
    return { left: box.x, right: box.x + box.width };
  }));
  expect(recording[2]!.left).toBe(before[2]!.left);
  expect(recording[1]!.left).toBe(before[1]!.left);
  expect(recording[1]!.left - recording[0]!.right).toBeCloseTo(beforeGap, 0);
  expect(recording[2]!.left - recording[1]!.right).toBeCloseTo(beforeGap, 0);
  await stop.click();
});

test("dictation: hint, check, then hear a missed word", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");
  await page.getByRole("radiogroup", { name: "Lesson mode" }).getByRole("radio", { name: "Dictation" }).click();

  await page.getByRole("button", { name: "Show hint" }).first().click();
  await expect(page.getByText("G___ m______, h__ a__ y__ t____?")).toBeVisible();

  await page.getByLabel("What did you hear?").first().fill("Good, how are you tomorrow?");
  await page.getByRole("button", { name: "Check" }).first().click();
  await expect(page.getByText("Not quite: 4 of 6 words matched")).toBeVisible();
  const result = page.locator('[role="status"] p').filter({ hasText: "Not quite: 4 of 6 words matched" });
  await expect(result).toHaveAttribute("data-motion", "answer-nudge");
  await expect(result).toHaveCSS("animation-iteration-count", "1");
  expect(await result.evaluate((element) => getComputedStyle(element).animationName)).not.toBe("none");
  await expect(page.locator('[data-feedback="correct-word"]').first()).toBeVisible();

  await page.getByRole("button", { name: "Hear morning" }).click();
  await expect.poll(() => spoken(page)).toContain("morning");

  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByLabel("What did you hear?").first().fill("Good morning, how are you today?");
  await page.getByRole("button", { name: "Check" }).first().click();
  const correctResult = page.locator('[role="status"] p').filter({ hasText: "Correct: 6 of 6 words" });
  await expect(correctResult).toHaveAttribute("data-motion", "answer-correct");
  const checkmark = correctResult.locator('[data-motion="answer-correct"]');
  await expect(checkmark).toHaveCount(1);
  await expect(checkmark).toHaveCSS("animation-iteration-count", "1");
  expect(await checkmark.evaluate((element) => getComputedStyle(element).animationName)).not.toBe("none");

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("G___ m______, h__ a__ y__ t____?")).toHaveCount(0);
  await expect(page.getByLabel("What did you hear?").first()).toBeFocused();
});

test("A1 fill the blank: choose a word from the bank, then check", async ({ page }) => {
  await openLibraryLesson(page, "About Me");
  await page.getByRole("radiogroup", { name: "Lesson mode" }).getByRole("radio", { name: "Fill the blank" }).click();

  const bank = page.getByRole("group", { name: "Choose a word" }).first();
  await expect(bank.getByRole("button")).toHaveCount(4);
  await bank.getByRole("button", { name: "name", exact: true }).click();
  const input = page.getByLabel("Which word fills the blank?").first();
  await expect(input).toHaveValue("name");
  await expect(input).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.getByText("Correct", { exact: true })).toBeVisible();
  const result = page.locator('[role="status"] p').filter({ hasText: "Correct" }).first();
  await expect(result.locator('[data-motion="answer-correct"]')).toHaveCount(1);
  const mark = result.locator('[data-motion="answer-correct"]');
  await expect(mark).toHaveCSS("animation-iteration-count", "1");
  expect(await mark.evaluate((element) => getComputedStyle(element).animationName)).not.toBe("none");
  await expect(mark.locator("svg")).toBeVisible();
});

test("hide one sentence's text and keep practising it", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");
  const first = page.getByRole("listitem").first();

  const toggle = first.getByRole("button", { name: "Text", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(first.getByRole("button", { name: "morning", exact: true })).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toBeFocused();
  await expect(page.getByRole("button", { name: "nice", exact: true })).toBeVisible();

  await first.getByRole("button", { name: "Listen" }).click();
  await expect.poll(() => spoken(page)).toContain("Good morning, how are you today?");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(first.getByRole("button", { name: "morning", exact: true })).toBeVisible();
});
