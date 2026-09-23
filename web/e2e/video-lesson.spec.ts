import { expect, test } from "./fixtures";

const TRANSCRIPT = "0:00\nHello there, my friend.\n0:07\nThis is the second line.";

test("video lesson from a YouTube URL and a pasted transcript", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Title").fill("Video lesson");
  await page.getByLabel("YouTube URL").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByLabel("Text", { exact: true }).fill(TRANSCRIPT);
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Video lesson" })).toBeVisible();
  await expect(page.getByText("Video from YouTube; playing it connects to YouTube.")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __yt?: { created: unknown[] } }).__yt?.created))
    .toEqual([{ videoId: "dQw4w9WgXcQ", host: "https://www.youtube-nocookie.com" }]);

  const clips = page.getByRole("button", { name: "Play clip" });
  await expect(clips).toHaveCount(2);
  await expect(clips.nth(1)).toBeEnabled();
  await clips.nth(1).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __yt: { calls: unknown[][] } }).__yt.calls))
    .toContainEqual(["seekTo", 7, true]);
});
