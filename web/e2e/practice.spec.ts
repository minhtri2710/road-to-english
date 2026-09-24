import type { Page } from "@playwright/test";

import { expect, openLibraryLesson, test } from "./fixtures";

const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

test("dictation: hint, check, then hear a missed word", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");
  await page.getByRole("button", { name: "Dictation" }).click();

  await page.getByRole("button", { name: "Show hint" }).first().click();
  await expect(page.getByText("G___ m______, h__ a__ y__ t____?")).toBeVisible();

  await page.getByLabel("What did you hear?").first().fill("Good, how are you tomorrow?");
  await page.getByRole("button", { name: "Check" }).first().click();
  await expect(page.getByText("Not quite: 4 of 6 words matched")).toBeVisible();

  await page.getByRole("button", { name: "Hear morning" }).click();
  await expect.poll(() => spoken(page)).toContain("morning");

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("G___ m______, h__ a__ y__ t____?")).toHaveCount(0);
  await expect(page.getByLabel("What did you hear?").first()).toBeFocused();
});

test("A1 fill the blank: choose a word from the bank, then check", async ({ page }) => {
  await openLibraryLesson(page, "About Me");
  await page.getByRole("button", { name: "Fill the blank" }).click();

  const bank = page.getByRole("group", { name: "Choose a word" }).first();
  await expect(bank.getByRole("button")).toHaveCount(4);
  await bank.getByRole("button", { name: "name", exact: true }).click();
  const input = page.getByLabel("Which word fills the blank?").first();
  await expect(input).toHaveValue("name");
  await expect(input).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.getByText("Correct", { exact: true })).toBeVisible();
});

test("hide one sentence's text and keep practising it", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");
  const first = page.getByRole("listitem").first();

  const toggle = first.getByRole("button", { name: "Hide text" });
  await toggle.click();
  await expect(first.getByRole("button", { name: "morning", exact: true })).toHaveCount(0);
  await expect(first.getByRole("button", { name: "Show text" })).toBeFocused();
  await expect(page.getByRole("button", { name: "nice", exact: true })).toBeVisible();

  await first.getByRole("button", { name: "Listen" }).click();
  await expect.poll(() => spoken(page)).toContain("Good morning, how are you today?");

  await first.getByRole("button", { name: "Show text" }).click();
  await expect(first.getByRole("button", { name: "morning", exact: true })).toBeVisible();
});
