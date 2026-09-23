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

test("the video player fits a 375px viewport at 16:9", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByLabel("Title").fill("Narrow video");
  await page.getByLabel("YouTube URL").fill("https://youtu.be/dQw4w9WgXcQ");
  await page.getByLabel("Text", { exact: true }).fill(TRANSCRIPT);
  await page.getByRole("button", { name: "Create" }).click();

  const frame = page.getByTitle("YouTube video player");
  await expect(frame).toBeVisible();
  await expect(page.getByText("Loading video…")).toHaveCount(0);
  const box = await frame.boundingBox();
  const column = await frame.evaluate((node) => node.parentElement!.getBoundingClientRect().width);
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(box!.width).toBeCloseTo(column, 0);
  expect(box!.height).toBeCloseTo((box!.width * 9) / 16, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
