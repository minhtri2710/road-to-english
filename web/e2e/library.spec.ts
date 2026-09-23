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
