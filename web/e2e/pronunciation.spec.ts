import { expect, menuItem, openLibraryLesson, test } from "./fixtures";

test("pronunciation check: disclosure, enable, wrong word, persists on reload", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");

  const toggle = await menuItem(page, "Pronunciation check");
  await toggle.click();
  await expect(page.getByRole("button", { name: "Enable" })).toBeFocused();
  await expect(page.getByText(/uses your browser's speech recognition/)).toBeVisible();
  await page.getByRole("button", { name: "Enable" }).click();
  await expect(page.getByRole("button", { name: "Display" })).toBeFocused();
  await expect(await menuItem(page, "Pronunciation check")).toHaveAttribute("aria-checked", "true");

  await page.evaluate(() => {
    (window as unknown as { __speechTranscript: string }).__speechTranscript =
      "Good evening, how are you today?";
  });
  await page.getByRole("button", { name: "Check pronunciation" }).first().click();
  await expect(page.getByText('morning (you said "evening")')).toBeVisible();
  await expect(page.getByText("What the browser heard: Good evening, how are you today?")).toBeVisible();
  await expect(page.getByText("The browser matched 5 of 6 words")).toBeVisible();

  await page.reload();
  await openLibraryLesson(page, "Greetings & Basics");
  await expect(await menuItem(page, "Pronunciation check")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Check pronunciation" }).first()).toBeVisible();
});
