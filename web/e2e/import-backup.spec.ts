import { createLesson, downloadText, expect, test, viewLink } from "./fixtures";

const TITLE = "My pasted text";
const TEXT = "The first sentence is short. The second one follows.\n\nA new paragraph starts here.";

test("import text, export a backup, delete, restore from the backup", async ({ page }) => {
  await createLesson(page, { title: TITLE, text: TEXT });

  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(page.getByRole("button", { name: "Listen" })).toHaveCount(3);
  await expect(page.getByText("A new paragraph starts here.")).toBeVisible();

  await page.getByRole("button", { name: "Back to lessons" }).click();
  const deleteButton = page.getByRole("button", { name: `Delete ${TITLE}` });
  await expect(deleteButton).toBeVisible();
  await expect(page.getByText("B1 · 3 sentences")).toBeVisible();

  await viewLink(page, "Library").click();
  await expect(page.getByRole("button", { name: `Delete ${TITLE}` })).toBeVisible();
  await viewLink(page, "Manage").click();
  await expect(page.getByRole("heading", { level: 2, name: "Your data" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  const backup = JSON.parse(await downloadText(download)) as { userLessons: { title: string }[] };
  expect(backup.userLessons.map((lesson) => lesson.title)).toEqual([TITLE]);

  await viewLink(page, "Library").click();
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain(`Delete "${TITLE}"?`);
    void dialog.accept();
  });
  await deleteButton.click();
  await expect(page.getByRole("heading", { name: "No lessons of your own yet" })).toBeVisible();

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("replace all local data");
    void dialog.accept();
  });
  await viewLink(page, "Manage").click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await (await chooserPromise).setFiles(backupPath);
  await viewLink(page, "Library").click();
  await expect(page.getByRole("button", { name: `Delete ${TITLE}` })).toBeVisible();
});
