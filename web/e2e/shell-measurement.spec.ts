import { expect, test } from "./fixtures";

test("library heading stays near the top with the storage notice", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { persist: () => Promise.resolve(false) },
    });
  });
  await page.goto("/");
  await expect(page.locator("header").getByText("Progress saved only in this browser")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Lesson library" })).toBeVisible();
  const box = await page.getByRole("heading", { level: 1, name: "Lesson library" }).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeLessThanOrEqual(150);
  console.log(`V1 library h1 top: ${box!.y}px (1280x900, storage notice visible)`);
});
