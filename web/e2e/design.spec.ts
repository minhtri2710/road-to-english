import { createLesson, expect, test, TRANSCRIPT, viewLink } from "./fixtures";

test("from tablet width up, body text is 16px and buttons are 44px; phones keep the compact sizes", async ({ page }) => {
  const sizes = async () =>
    page.evaluate(() => ({
      text: getComputedStyle(document.querySelector("[data-astryx-theme]")!).getPropertyValue("--font-size-base").trim(),
    }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "About Me" })).toBeVisible();
  expect((await sizes()).text).toBe("1rem");
  await expect(page.getByRole("button", { name: "Start lesson" })).toHaveCSS("height", "44px");

  await page.setViewportSize({ width: 375, height: 667 });
  expect((await sizes()).text).toBe("0.875rem");
});

test("a video lesson's card shows its YouTube thumbnail", async ({ page }) => {
  await createLesson(page, { title: "Video card", text: TRANSCRIPT, videoUrl: "https://youtu.be/dQw4w9WgXcQ" });
  await expect(page.getByRole("heading", { level: 1, name: "Video card" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Video lessons show their thumbnail from YouTube.")).toBeVisible();
  const thumbnail = page.locator('img[src="https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg"]');
  await expect(thumbnail).toHaveCount(1);
  await expect(thumbnail).toHaveAttribute("alt", "");
  // The thumbnail opens the lesson too (its play mark sits over the image's center).
  await thumbnail.locator("..").click();
  await expect(page.getByRole("heading", { level: 1, name: "Video card" })).toBeVisible();
});

test("the header's Continue practising reopens the last lesson, and phones skip it", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, "persist", { configurable: true, value: () => Promise.resolve(true) });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const header = page.locator("header");
  await expect(header.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  // No lesson opened yet, and the library is where Start practising leads: no button.
  await expect(header.getByRole("button", { name: /practising/ })).toHaveCount(0);

  await page.getByRole("button", { name: "About Me" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "About Me" })).toBeVisible();
  // On the last lesson itself it would lead nowhere.
  await expect(header.getByRole("button", { name: "Continue practising" })).toHaveCount(0);
  await viewLink(page, "Library").click();
  await header.getByRole("button", { name: "Continue practising" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "About Me" })).toBeVisible();

  await viewLink(page, "Library").click();
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(header.getByRole("button", { name: "Continue practising" })).toBeHidden();
});
