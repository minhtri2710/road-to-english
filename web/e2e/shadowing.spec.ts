import { expect, openLibraryLesson, test } from "./fixtures";

test("shadow a library lesson, save a word, review it", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");

  await page.getByRole("button", { name: "Listen" }).first().click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken))
    .toContain("Good morning, how are you today?");

  await page.getByRole("button", { name: "morning", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hear word" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Define" })).toBeVisible();
  await page.getByRole("button", { name: "Save word" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toHaveAccessibleName("Saved, remove from review deck");

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("1 due")).toBeVisible();
  await expect(page.getByText("morning", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.getByRole("button", { name: "Good" }).click();
  await expect(page.getByText("0 due")).toBeVisible();
  await expect(page.getByText(/All caught up/)).toBeVisible();
});

test("remove a saved word with the Saved toggle, then Undo puts it back in Review", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");
  await page.getByRole("button", { name: "morning", exact: true }).click();
  await page.getByRole("button", { name: "Save word" }).click();
  const saved = page.getByRole("button", { name: "Saved, remove from review deck" });
  await expect(saved).toBeVisible();

  await saved.focus();
  await page.keyboard.press("Enter");
  const save = page.getByRole("button", { name: "Save word" });
  await expect(save).toBeFocused();
  await expect(page.getByLabel("Notifications").getByText("Removed from your review deck.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Removed from your review deck." })).toHaveCount(1);

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("0 due")).toBeVisible();

  const undo = page.getByRole("button", { name: "Undo" });
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("1 due")).toBeVisible();
  await expect(page.getByText("morning", { exact: true })).toBeVisible();
});

test("save a hyphenated compound as one word and review it", async ({ page }) => {
  await openLibraryLesson(page, "Weather & Clothes");

  await expect(page.getByRole("button", { name: "T", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "T-shirt", exact: true }).click();
  await page.getByRole("button", { name: "Save word" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toHaveAccessibleName("Saved, remove from review deck");

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("1 due")).toBeVisible();
  await expect(page.getByText("T-shirt", { exact: true })).toBeVisible();
});

test("shadow one sentence at a time through to the last sentence and back", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");
  const guided = page.getByRole("button", { name: "One at a time" });
  await guided.click();
  await expect(guided).toHaveAttribute("aria-pressed", "true");

  const position = page.getByRole("heading", { level: 2 });
  await expect(position).toHaveText("Sentence 1 of 9");
  await expect(page.getByRole("button", { name: "Text", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Previous" })).toHaveAttribute("aria-disabled", "true");

  const next = page.getByRole("button", { name: "Next" });
  await next.click();
  await expect(position).toHaveText("Sentence 2 of 9");
  await expect(position).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Sentence 2 of 9" })).toHaveCount(1);
  for (let sentence = 3; sentence <= 9; sentence += 1) {
    await next.click();
    await expect(position).toHaveText(`Sentence ${sentence} of 9`);
  }
  await expect(page.getByText("Long time no see. How have you been?")).toBeVisible();
  await expect(next).toHaveAttribute("aria-disabled", "true");
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(position).toHaveText("Sentence 9 of 9");
  await expect(next).toBeFocused();

  const previous = page.getByRole("button", { name: "Previous" });
  for (let sentence = 8; sentence >= 1; sentence -= 1) {
    await previous.click();
    await expect(position).toHaveText(`Sentence ${sentence} of 9`);
  }
  await expect(page.getByText("Good morning, how are you today?")).toBeVisible();
  await expect(previous).toHaveAttribute("aria-disabled", "true");

  await guided.click();
  await expect(position).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Text", exact: true })).toHaveCount(9);
});
