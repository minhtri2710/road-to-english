import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

async function axe(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`));
}

const toVietnamese = (page: Page) => page.getByTestId("language-switch");

test("switches the interface to Vietnamese and back, and remembers the choice", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Lesson library" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(toVietnamese(page)).toHaveText("Tiếng Việt");

  await toVietnamese(page).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await expect(page.getByRole("heading", { level: 1, name: "Thư viện bài học" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: /./ }).first()).toContainText("Thư viện");
  await expect(toVietnamese(page)).toHaveText("English");

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Thư viện bài học" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");

  await toVietnamese(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lesson library" })).toBeVisible();
});

for (const path of ["/", "/#/about", "/#/review", "/#/manage"]) {
  test(`Vietnamese ${path} has no axe violations and no horizontal scroll at 320px`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("road-to-english.lang", "vi"));
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
}

test("a Vietnamese lesson keeps its English sentences", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("road-to-english.lang", "vi"));
  await page.goto("/");
  await page.getByRole("button", { name: "Greetings & Basics" }).click();
  await expect(page.getByText("Good morning, how are you today?", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nghe", exact: true }).first()).toBeVisible();
});
