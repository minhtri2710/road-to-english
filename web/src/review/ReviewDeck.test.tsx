import { afterEach, describe, expect, it } from "vitest";

import { todayKey } from "../lib/progress";
import { recordPractice } from "../lib/progressStore";
import { createCard, State } from "../lib/vocab";
import { putCard } from "../lib/vocabStore";
import {
  buttonsNamed,
  click,
  hasText,
  renderApp,
  resetApp,
  waitForCondition,
} from "../test/app";

describe("ReviewDeck", () => {
  afterEach(resetApp);

  it("shows the no-cards empty state and Go to library switches the view", async () => {
    const { container } = await renderApp();
    await click(container, "Review");
    await waitForCondition(
      hasText(container, "Nothing to review yet. Save a sentence or a word from a lesson to build your deck."),
    );
    await click(container, "Go to library");
    expect(container.querySelector("h1")?.textContent).toBe("Lesson library");
    await waitForCondition(hasText(container, "Greetings & Basics"));
  });

  it("shows All caught up when cards exist but none are due", async () => {
    const card = createCard({ front: "f", back: "b", source: { lessonId: "l", sentenceId: "s", word: "" } }, new Date());
    await putCard({ ...card, fsrs: { ...card.fsrs, due: new Date(Date.now() + 86_400_000), state: State.Review } });
    const { container } = await renderApp();
    await click(container, "Review");
    await waitForCondition(hasText(container, "All caught up. Come back later for your next review."));
    const line = Array.from(container.querySelectorAll("p")).find((p) => p.textContent?.startsWith("All caught up"));
    expect(line?.tabIndex).toBe(-1);
    expect(buttonsNamed(container, "Go to library")).toHaveLength(1);
  });

  it("says how many new cards the daily cap hides", async () => {
    for (let index = 0; index < 3; index += 1) {
      await putCard(
        createCard({ front: `f${index}`, back: "b", source: { lessonId: "l", sentenceId: `s${index}`, word: "" } }, new Date()),
      );
    }
    for (let index = 0; index < 20; index += 1) {
      await recordPractice(todayKey(new Date()), { newCard: true });
    }
    const { container } = await renderApp();
    await click(container, "Review");
    await waitForCondition(hasText(container, "Daily limit of 20 new cards reached. 3 new cards are waiting."));
    expect(container.textContent).toContain("0 due");
  });
});
