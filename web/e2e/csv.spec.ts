import { downloadText, expect, test } from "./fixtures";

test("Export CSV in Your data downloads a BOM-prefixed card file", async ({ page }) => {
  await page.goto("/#/manage");
  await expect(page.getByRole("heading", { level: 1, name: "Manage lessons and data" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("region", { name: "Your data" }).getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^road-to-english-cards-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(await downloadText(download)).toMatch(/^\uFEFF"front","back","due"\r\n/);
});
