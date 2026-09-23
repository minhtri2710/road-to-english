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
