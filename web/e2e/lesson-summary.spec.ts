import { attemptEverySentence, expect, missOneWord, openLibraryLesson, test } from "./fixtures";

test("attempting every sentence completes the lesson and shows the summary", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");
  await attemptEverySentence(page);

  const summary = page.getByRole("region", { name: "Lesson complete" });
  await expect(summary.getByText("You practised all 9 sentences.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Lesson complete." })).toHaveCount(1);
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await expect(summary.getByRole("button", { name: "Next lesson: Shopping Basics" })).toBeVisible();

  await summary.getByRole("button", { name: "Back to lessons" }).click();
  await expect(page.getByRole("button", { name: /Greetings & Basics/ })).toContainText("Completed");
});

test("a word missed in dictation is listed in the summary and saved to Review", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");
  await missOneWord(page);

  const missed = page.getByRole("list", { name: "Missed words" });
  await expect(missed.getByRole("listitem")).toHaveCount(1);
  await expect(missed.getByRole("listitem")).toContainText("today");
  await missed.getByRole("button", { name: "Save “today” to review" }).click();
  await expect(missed.getByRole("button", { name: "Saved “today”, remove from review deck" })).toBeVisible();

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("1 due")).toBeVisible();
  await expect(page.getByText("today", { exact: true })).toBeVisible();
});
