import { afterEach, describe, expect, it, vi } from "vitest";

import * as progressStore from "../lib/progressStore";
import * as userLessonsStore from "../lib/userLessons";
import { click, harnessAct, hasText, renderApp, resetApp, waitForCondition } from "../test/app";
import { userLesson } from "../test/fixtures";

describe("UserLessonList", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await resetApp();
  });

  it("shares the lesson card name, description, completed state and Delete action", async () => {
    await userLessonsStore.putUserLesson(userLesson);
    await progressStore.markLessonComplete(userLesson.id);
    const { container } = await renderApp();
    await waitForCondition(hasText(container, userLesson.title));
    const row = Array.from(container.querySelectorAll("main li button")).find(
      (button) => button.getAttribute("aria-label") === userLesson.title,
    )!;
    const description = (row.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent)
      .join(" ");
    expect(description).toBe("B1 · 2 sentences 110 WPM Completed");
    expect(row.textContent).toContain("Completed");
    expect(container.querySelector(`[aria-label="Delete ${userLesson.title}"]`)).not.toBeNull();
  });

  it("keeps the delete failure alert", async () => {
    await userLessonsStore.putUserLesson(userLesson);
    vi.stubGlobal("confirm", () => true);
    vi.spyOn(userLessonsStore, "deleteUserLesson").mockRejectedValue(new Error("storage unavailable"));
    const { container } = await renderApp();
    await waitForCondition(hasText(container, userLesson.title));
    const deleteButton = container.querySelector<HTMLButtonElement>(`[aria-label="Delete ${userLesson.title}"]`)!;
    await harnessAct(async () => deleteButton.click());
    await waitForCondition(hasText(container, "Couldn't delete. Try again."));
    expect(container.textContent).toContain("Couldn't delete. Try again.");
  });

  it("shows an empty state whose Create a lesson button moves focus to the import Title", async () => {
    const { container } = await renderApp();
    await waitForCondition(hasText(container, "No lessons of your own yet"));
    const empty = container.querySelector('[role="status"] h3');
    expect(empty?.textContent).toBe("No lessons of your own yet");
    expect(container.textContent).toContain("Paste a transcript or any English text to practise it as a lesson.");

    await click(container, "Create a lesson");
    expect(container.querySelector("h1")?.textContent).toBe("Manage lessons and data");
    expect(document.activeElement).toBe(container.querySelector("#import-title"));
    await harnessAct(async () => undefined);
  });
});
