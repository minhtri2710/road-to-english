import { attemptEverySentence, expect, openLibraryLesson, test } from "./fixtures";

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
