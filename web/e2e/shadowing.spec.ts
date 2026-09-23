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
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("1 due")).toBeVisible();
  await expect(page.getByText("morning", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.getByRole("button", { name: "Good" }).click();
  await expect(page.getByText("0 due")).toBeVisible();
  await expect(page.getByText(/Nothing due/)).toBeVisible();
});
