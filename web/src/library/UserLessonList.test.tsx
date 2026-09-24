import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { click, hasText, renderApp, resetApp, waitForCondition } from "../test/app";

describe("UserLessonList", () => {
  afterEach(resetApp);

  it("shows an empty state whose Create a lesson button moves focus to the import Title", async () => {
    const { container } = await renderApp();
    await waitForCondition(hasText(container, "No lessons of your own yet"));
    const empty = container.querySelector('[role="status"] h3');
    expect(empty?.textContent).toBe("No lessons of your own yet");
    expect(container.textContent).toContain("Paste a transcript or any English text to practise it as a lesson.");

    await click(container, "Create a lesson");
    expect(document.activeElement).toBe(container.querySelector("#import-title"));
    await act(async () => undefined);
  });
});
