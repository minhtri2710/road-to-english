import { expect, test } from "./fixtures";

test("the library starts with the A1 lesson About Me", async ({ page }) => {
  await page.goto("/");
  const firstLesson = page.getByRole("button").filter({ hasText: /· \d+ sentences/ }).first();
  await expect(firstLesson).toContainText("About Me");
  await expect(firstLesson).toContainText("A1 · 9 sentences");

  await firstLesson.click();
  await expect(page.getByRole("heading", { level: 1, name: "About Me" })).toBeVisible();
  await expect(page.getByText("Level A1")).toBeVisible();
  await expect(page.getByText("My name is Lan.", { exact: true })).toBeVisible();
});

test("the level filter narrows the library rows and survives a reload", async ({ page }) => {
  await page.goto("/");
  const rows = page.getByRole("button").filter({ hasText: /· \d+ sentences/ });
  await expect(rows.first()).toContainText("About Me");
  await expect(page.getByText("0 of 17 completed")).toBeVisible();

  const level = page.getByRole("radiogroup", { name: "Level" });
  await level.getByRole("radio", { name: "B2" }).click();
  await expect(level.getByRole("radio", { name: "B2" })).toBeFocused();
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText("B2 ·");
  await expect(page.getByText("B2: 0 of 4 completed")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "B2: 0 of 4 completed" })).toHaveAttribute("aria-valuemax", "4");

  await page.reload();
  await expect(page.getByRole("radio", { name: "B2" })).toHaveAttribute("aria-checked", "true");
  await expect(rows).toHaveCount(4);
});

test("Today offers Continue for the lesson opened last", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Next: About Me")).toBeVisible();
  await page.getByRole("button", { name: "Daily Routine" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Daily Routine" })).toBeVisible();
  await page.getByRole("button", { name: "Back to lessons" }).click();

  await expect(page.getByText("Continue: Daily Routine")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Daily Routine" })).toBeVisible();
});

test("the own-lessons empty state's Create a lesson moves focus to the Title field", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "No lessons of your own yet" })).toBeVisible();
  await expect(page.getByText("Paste a transcript or any English text to practise it as a lesson.")).toBeVisible();
  await page.getByRole("button", { name: "Create a lesson" }).click();
  await expect(page.getByLabel("Title")).toBeFocused();
});
