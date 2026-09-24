import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCard } from "../lib/vocab";
import { getAllCards, putCard } from "../lib/vocabStore";
import * as vocabStore from "../lib/vocabStore";
import {
  buttonsNamed,
  fetchMock,
  openLesson,
  reopenGreetings,
  renderApp,
  resetApp,
  waitForCondition,
} from "../test/app";
import { installSpeechFakes } from "../test/browser";
import { greetingsLesson } from "../test/fixtures";

describe("WordPanel", () => {
  afterEach(resetApp);

  it("expands the selected word's button and points it at the word panel", async () => {
    installSpeechFakes();
    const { container } = await openLesson();
    const word = buttonsNamed(container, "morning")[0]!;
    expect(word.getAttribute("aria-expanded")).toBe("false");
    expect(word.hasAttribute("aria-controls")).toBe(false);

    await act(async () => {
      word.click();
    });
    expect(word.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(word.getAttribute("aria-controls") ?? "");
    expect(buttonsNamed(panel!, "Hear word")).toHaveLength(1);
    expect(buttonsNamed(container, "Good")[0]!.getAttribute("aria-expanded")).toBe("false");
  });

  it("announces a saved word, and keeps the removal toast with Undo until it is dismissed", async () => {
    installSpeechFakes();
    const { container } = await openLesson();
    await act(async () => {
      buttonsNamed(container, "morning")[0]!.click();
    });
    const announced = () =>
      Array.from(container.querySelectorAll('[role="status"]:not([aria-live])')).map((region) => region.textContent);
    expect(announced()).not.toContain("Saved to your review deck.");
    await act(async () => {
      buttonsNamed(container, "Save word")[0]!.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    expect(announced()).toContain("Saved to your review deck.");

    // Earlier tests can leave toasts behind.
    const earlier = new Set(buttonsNamed(document.body, "Undo"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () => {
        buttonsNamed(container, "Saved")[0]!.click();
      });
      await waitForCondition(() => buttonsNamed(document.body, "Undo").some((undo) => !earlier.has(undo)));
      expect(announced()).not.toContain("Saved to your review deck.");
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      const undo = buttonsNamed(document.body, "Undo").find((button) => !earlier.has(button))!;
      // jsdom runs no transitions: end the toast row's own, which removes the row if it is hiding.
      await act(async () => {
        for (let node: HTMLElement | null = undo; node; node = node.parentElement) {
          node.dispatchEvent(Object.assign(new Event("transitionend", { bubbles: true }), { propertyName: "grid-template-rows" }));
        }
      });
      expect(undo.isConnected).toBe(true);
      expect(undo?.closest("[data-toast-id]")?.textContent).toContain("Removed from your review deck. Undo restores it.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists only one card when save is clicked twice synchronously", async () => {
    const { container } = await openLesson();
    const sentence = greetingsLesson.sentences[0];
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save to review",
    );
    if (!saveButton) throw new Error("Save to review button not found");

    await act(async () => {
      saveButton.click();
      saveButton.click();
    });
    await waitForCondition(() => container.textContent?.includes("Saved") ?? false);
    await act(async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    const cards = await getAllCards();
    expect(
      cards.filter((card) => card.source.sentenceId === sentence.id),
    ).toHaveLength(1);
  });

  it("persists saved cards across an app remount", async () => {
    const first = await openLesson();
    const firstSave = Array.from(first.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save to review",
    );

    await act(async () => {
      firstSave?.click();
    });
    await waitForCondition(() => first.container.textContent?.includes("Saved") ?? false);

    await act(async () => {
      first.root.unmount();
    });
    first.container.remove();

    const { container: secondContainer } = await renderApp();
    await act(async () => {
      Array.from(secondContainer.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Review"))
        ?.click();
    });
    await waitForCondition(
      () => secondContainer.textContent?.includes(greetingsLesson.sentences[0].text) ?? false,
    );

    expect(secondContainer.textContent).toContain(
      greetingsLesson.sentences[0].text,
    );
  });

  it("shows Hear and Save for a clicked word and speaks the word after stopping Loop", async () => {
    const speech = installSpeechFakes();
    const { container } = await openLesson();
    const sentence = greetingsLesson.sentences[0];

    expect(buttonsNamed(container, "Hear word")).toHaveLength(0);
    expect(container.textContent).toContain(sentence.text);
    await act(async () => {
      buttonsNamed(container, "Loop")[0]?.click();
    });
    await act(async () => {
      buttonsNamed(container, "morning")[0]?.click();
    });
    expect(buttonsNamed(container, "Hear word")).toHaveLength(1);
    expect(buttonsNamed(container, "Save word")).toHaveLength(1);

    await act(async () => {
      buttonsNamed(container, "Hear word")[0]?.click();
    });
    expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
    expect(speech.spoken.at(-1)?.text).toBe("morning");
    await act(async () => {
      speech.finish();
    });
    expect(speech.spoken.at(-1)?.text).toBe("morning");

    await act(async () => {
      buttonsNamed(container, "nice")[0]?.click();
    });
    expect(buttonsNamed(container, "Hear word")).toHaveLength(1);
    expect(container.textContent).not.toContain("morningHear word");
  });

  it("saves one word card under a synchronous double click, keeps it Saved across a remount, and reviews it", async () => {
    installSpeechFakes();
    const { container, root } = await openLesson();
    const sentence = greetingsLesson.sentences[0];

    await act(async () => {
      buttonsNamed(container, "morning")[0]?.click();
    });
    const save = buttonsNamed(container, "Save word")[0];
    if (!save) throw new Error("Save word button not found");
    // putCard is keyed by id, so a second write would not change the card count; count the writes.
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    await act(async () => {
      save.click();
      save.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    await act(async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    expect(put.mock.contexts.filter((store) => (store as IDBObjectStore).name === "cards")).toHaveLength(1);
    put.mockRestore();
    const cards = await getAllCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: `greetings-basics:${sentence.id}:morning`,
      front: "morning",
      back: `${sentence.text} — ${sentence.vi}`,
      source: { lessonId: "greetings-basics", sentenceId: sentence.id, word: "morning" },
    });
    expect(buttonsNamed(container, "Save to review")).toHaveLength(3);

    await act(async () => {
      root.unmount();
    });
    container.remove();

    const second = await openLesson();
    await act(async () => {
      buttonsNamed(second.container, "morning")[0]?.click();
    });
    await waitForCondition(() => buttonsNamed(second.container, "Saved").length === 1);
    expect(buttonsNamed(second.container, "Save word")).toHaveLength(0);

    await act(async () => {
      buttonsNamed(second.container, "Review")[0]?.click();
    });
    await waitForCondition(() => second.container.textContent?.includes("Show answer") ?? false);
    expect(second.container.textContent).toContain("morning");
    await act(async () => {
      buttonsNamed(second.container, "Show answer")[0]?.click();
    });
    expect(second.container.textContent).toContain(`${sentence.text} — ${sentence.vi}`);
    await act(async () => {
      buttonsNamed(second.container, "Good")[0]?.click();
    });
    await waitForCondition(() => second.container.textContent?.includes("All caught up") ?? false);
    const [reviewed] = await getAllCards();
    expect(reviewed?.fsrs.reps).toBe(1);
  });

  it("renders a hyphenated compound as one word button and saves it as one card", async () => {
    installSpeechFakes();
    const sentence = {
      id: "weather-and-clothes-9",
      text: "I wear a T-shirt and shorts.",
      vi: "Tôi mặc áo phông và quần soóc.",
    };
    const { container } = await openLesson({ ...greetingsLesson, sentences: [sentence] });

    expect(buttonsNamed(container, "T-shirt")).toHaveLength(1);
    expect(buttonsNamed(container, "T")).toHaveLength(0);
    expect(buttonsNamed(container, "shirt")).toHaveLength(0);
    await act(async () => {
      buttonsNamed(container, "T-shirt")[0]?.click();
    });
    await act(async () => {
      buttonsNamed(container, "Save word")[0]?.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    const [card] = await getAllCards();
    expect(card?.id).toBe(`greetings-basics:${sentence.id}:t-shirt`);
    expect(card?.source.word).toBe("t-shirt");
  });

  it("removes a saved card with the Saved toggle, offers Undo that restores it, and re-saves it fresh", async () => {
    const sentence = greetingsLesson.sentences[0];
    const created = new Date("2026-01-01T00:00:00.000Z");
    const original = createCard(
      { front: sentence.text, back: "", source: { lessonId: "greetings-basics", sentenceId: sentence.id, word: "" } },
      created,
    );
    await putCard(original);
    const { container } = await openLesson();
    const showView = async (name: "Review" | "Library") => {
      await act(async () => {
        buttonsNamed(container, name)[0]?.click();
      });
    };
    // Library lists the lessons, so going back to the lesson reopens it from its row.
    const reopenLesson = async () => {
      await showView("Library");
      await reopenGreetings(container);
    };
    const dueBadge = () => container.textContent?.match(/(\d+) due/)?.[1];
    const stored = async () => (await getAllCards()).find(({ id }) => id === original.id);

    await showView("Review");
    await waitForCondition(() => dueBadge() === "1");
    await reopenLesson();
    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    const toggle = buttonsNamed(container, "Saved")[0]!;
    expect(toggle.getAttribute("aria-label")).toBe("Saved, remove from review deck");
    // Earlier tests can leave toasts behind: jsdom never ends a toast's exit transition.
    const earlier = new Set(buttonsNamed(document.body, "Undo"));
    toggle.focus();
    await act(async () => {
      toggle.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Save to review").length === 3);
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-label")).toBeNull();
    expect((await stored())?.deletedAt).not.toBeNull();
    await waitForCondition(() => document.body.textContent?.includes("Removed from your review deck.") ?? false);
    await showView("Review");
    await waitForCondition(() => dueBadge() === "0");
    await reopenLesson();

    const undo = buttonsNamed(document.body, "Undo").find((button) => !earlier.has(button));
    if (!undo) throw new Error("Undo button not found");
    await act(async () => {
      undo.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    const restored = await stored();
    expect(restored).toMatchObject({ fsrs: original.fsrs, deletedAt: null });
    expect(Date.parse(restored!.updatedAt)).toBeGreaterThan(created.getTime());
    await showView("Review");
    await waitForCondition(() => dueBadge() === "1");
    await reopenLesson();

    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    await act(async () => {
      buttonsNamed(container, "Saved")[0]!.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Save to review").length === 3);
    await act(async () => {
      buttonsNamed(container, "Save to review")[0]!.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    const resaved = await stored();
    expect(resaved?.deletedAt).toBeNull();
    expect(resaved?.fsrs.due.getTime()).toBeGreaterThan(created.getTime());
    expect(await getAllCards()).toHaveLength(1);
  });

  it("undoes nothing when the card was re-saved after the remove, keeping the fresh card", async () => {
    const sentence = greetingsLesson.sentences[0];
    const created = new Date("2026-01-01T00:00:00.000Z");
    const original = createCard(
      { front: sentence.text, back: "", source: { lessonId: "greetings-basics", sentenceId: sentence.id, word: "" } },
      created,
    );
    await putCard(original);
    const { container } = await openLesson();
    const showView = async (name: "Review" | "Library") => {
      await act(async () => {
        buttonsNamed(container, name)[0]?.click();
      });
    };
    // Library lists the lessons, so going back to the lesson reopens it from its row.
    const reopenLesson = async () => {
      await showView("Library");
      await reopenGreetings(container);
    };
    const dueBadge = () => container.textContent?.match(/(\d+) due/)?.[1];
    const stored = async () => (await getAllCards()).find(({ id }) => id === original.id);

    await showView("Review");
    await waitForCondition(() => dueBadge() === "1");
    await reopenLesson();
    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    // Earlier tests can leave toasts in document.body; this test's toast is the newest Undo.
    const undoCount = buttonsNamed(document.body, "Undo").length;
    await act(async () => {
      buttonsNamed(container, "Saved")[0]!.click();
    });
    await waitForCondition(() => buttonsNamed(document.body, "Undo").length === undoCount + 1);
    await act(async () => {
      buttonsNamed(container, "Save to review")[0]!.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    const resaved = await stored();
    expect(resaved?.deletedAt).toBeNull();
    expect(resaved?.fsrs.due.getTime()).toBeGreaterThan(created.getTime());

    const undo = buttonsNamed(document.body, "Undo").at(-1)!;
    await act(async () => {
      undo.click();
    });
    await waitForCondition(
      () => document.body.textContent?.includes("Couldn't undo: this card changed since it was removed.") ?? false,
    );
    // happy-dom runs no CSS transitions; end the toast row's exit transition so a dismissed toast leaves the DOM.
    await act(async () => {
      for (let node = undo.parentElement; node; node = node.parentElement) {
        const end = new Event("transitionend", { bubbles: true });
        Object.defineProperty(end, "propertyName", { value: "grid-template-rows" });
        node.dispatchEvent(end);
      }
    });
    expect(undo.isConnected).toBe(false);
    expect(await stored()).toEqual(resaved);
    await showView("Review");
    await waitForCondition(() => dueBadge() === "1");
  });

  describe("Undo after the Saved toggle unmounted", () => {
    const sentence = greetingsLesson.sentences[0];
    const created = new Date("2026-01-01T00:00:00.000Z");
    const original = createCard(
      { front: sentence.text, back: "", source: { lessonId: "greetings-basics", sentenceId: sentence.id, word: "" } },
      created,
    );
    const stored = async () => (await getAllCards()).find(({ id }) => id === original.id);

    // Removes the saved card, then leaves the lesson so SaveToReview unmounts while its Undo toast stays open.
    async function removeThenLeave() {
      await putCard(original);
      const view = await openLesson();
      const { container } = view;
      await act(async () => {
        buttonsNamed(container, "Review")[0]?.click();
      });
      await waitForCondition(() => container.textContent?.match(/(\d+) due/)?.[1] === "1");
      await act(async () => {
        buttonsNamed(container, "Library")[0]?.click();
      });
      await reopenGreetings(container);
      await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
      const earlier = new Set(buttonsNamed(document.body, "Undo"));
      const newUndo = () => buttonsNamed(document.body, "Undo").find((button) => !earlier.has(button));
      await act(async () => {
        buttonsNamed(container, "Saved")[0]!.click();
      });
      await waitForCondition(() => newUndo() !== undefined);
      await act(async () => {
        buttonsNamed(container, "Back to lessons")[0]!.click();
      });
      await waitForCondition(() => buttonsNamed(container, "Back to lessons").length === 0);
      expect(buttonsNamed(container, "Saved")).toHaveLength(0);
      expect(buttonsNamed(container, "Save to review")).toHaveLength(0);
      return { ...view, undo: newUndo()! };
    }

    const toastSays = (message: string) => document.body.textContent?.includes(message) ?? false;

    it("shows the changed-card toast and keeps the stored card when the card changed after the remove", async () => {
      const { undo } = await removeThenLeave();
      const changed = { ...(await stored())!, updatedAt: new Date(Date.now() + 1000).toISOString() };
      await putCard(changed);

      await act(async () => {
        undo.click();
      });
      await waitForCondition(() => toastSays("Couldn't undo: this card changed since it was removed."));
      expect(await stored()).toEqual(changed);
    });

    it("restores the exact FSRS state from a clean tombstone", async () => {
      const { container, undo } = await removeThenLeave();
      await act(async () => {
        buttonsNamed(container, "Review")[0]?.click();
      });
      await waitForCondition(() => container.textContent?.match(/(\d+) due/)?.[1] === "0");

      await act(async () => {
        undo.click();
      });
      await waitForCondition(() => container.textContent?.match(/(\d+) due/)?.[1] === "1");
      expect(await stored()).toMatchObject({ fsrs: original.fsrs, deletedAt: null });
    });

    it("shows a try-again toast when the restore throws", async () => {
      const { undo } = await removeThenLeave();
      const tombstone = await stored();
      vi.spyOn(vocabStore, "restoreTombstone").mockRejectedValueOnce(new Error("quota"));

      await act(async () => {
        undo.click();
      });
      await waitForCondition(() => toastSays("Couldn't undo. Try again."));
      expect(await stored()).toEqual(tombstone);
    });
  });

  it("removes word buttons and the word panel when the transcript is hidden", async () => {
    installSpeechFakes();
    const { container } = await openLesson();

    await act(async () => {
      buttonsNamed(container, "morning")[0]?.click();
    });
    expect(buttonsNamed(container, "Hear word")).toHaveLength(1);
    await act(async () => {
      buttonsNamed(container, "Transcript")[0]?.click();
    });
    expect(buttonsNamed(container, "morning")).toHaveLength(0);
    expect(buttonsNamed(container, "Hear word")).toHaveLength(0);
    expect(buttonsNamed(container, "Save word")).toHaveLength(0);
  });

  describe("word dictionary", () => {
    const dictionaryPrefix = "https://api.dictionaryapi.dev/";

    function urlOf(input: Parameters<typeof fetch>[0]): string {
      return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    }

    function dictionaryCalls(): string[] {
      return fetchMock.mock.calls.map(([input]) => urlOf(input)).filter((url) => url.startsWith(dictionaryPrefix));
    }

    // Routes dictionary requests to `dictionary`, everything else to the lesson API fake.
    function routeDictionary(dictionary: (url: string) => Promise<Response>): void {
      const api = fetchMock.getMockImplementation();
      fetchMock.mockImplementation(async (input, init) => {
        const url = urlOf(input);
        return url.startsWith(dictionaryPrefix) ? dictionary(url) : api!(input, init);
      });
    }

    function definitionFor(word: string): Response {
      return new Response(
        JSON.stringify([
          {
            word,
            phonetic: `/${word}/`,
            meanings: [{ partOfSpeech: "noun", definitions: [{ definition: `Meaning of ${word}.` }] }],
          },
        ]),
        { status: 200 },
      );
    }

    it("looks a word up only when Define is clicked", async () => {
      installSpeechFakes();
      const { container } = await openLesson();
      routeDictionary(async (url) => definitionFor(url.split("/").at(-1)!));

      await act(async () => {
        buttonsNamed(container, "morning")[0]?.click();
      });
      expect(dictionaryCalls()).toHaveLength(0);

      await act(async () => {
        buttonsNamed(container, "Define")[0]?.click();
      });
      await waitForCondition(() => container.textContent?.includes("Meaning of morning.") ?? false);
      expect(dictionaryCalls()).toEqual(["https://api.dictionaryapi.dev/api/v2/entries/en/morning"]);
      expect(container.textContent).toContain("/morning/");
      expect(container.textContent).toContain("noun");
    });

    it("shows No definition when the lookup fails", async () => {
      installSpeechFakes();
      const { container } = await openLesson();
      routeDictionary(async () => new Response(JSON.stringify({ title: "No Definitions Found" }), { status: 404 }));

      await act(async () => {
        buttonsNamed(container, "morning")[0]?.click();
      });
      await act(async () => {
        buttonsNamed(container, "Define")[0]?.click();
      });
      await waitForCondition(() => container.textContent?.includes("No definition") ?? false);
    });

    it("never shows a late definition for the previous word under a newly selected word", async () => {
      installSpeechFakes();
      const { container } = await openLesson();
      let resolveMorning: (response: Response) => void = () => {};
      routeDictionary(
        () =>
          new Promise<Response>((resolve) => {
            resolveMorning = resolve;
          }),
      );

      await act(async () => {
        buttonsNamed(container, "morning")[0]?.click();
      });
      await act(async () => {
        buttonsNamed(container, "Define")[0]?.click();
      });
      expect(container.textContent).toContain("Looking up…");

      await act(async () => {
        buttonsNamed(container, "how")[0]?.click();
      });
      expect(container.textContent).not.toContain("Looking up…");
      await act(async () => {
        resolveMorning(definitionFor("morning"));
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      });
      expect(container.textContent).not.toContain("Meaning of morning.");
      expect(container.textContent).not.toContain("No definition");
      expect(buttonsNamed(container, "Define")).toHaveLength(1);
    });

    it("links the normalized word to YouGlish in a new tab without a referrer", async () => {
      installSpeechFakes();
      const { container } = await openLesson();

      await act(async () => {
        buttonsNamed(container, "Good")[0]?.click();
      });
      const link = Array.from(container.querySelectorAll("a")).find(
        (anchor) => anchor.textContent?.startsWith("Hear it on YouGlish"),
      );
      expect(link?.getAttribute("href")).toBe(
        "https://youglish.com/pronounce/" + encodeURIComponent("good") + "/english",
      );
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
      // Astryx's external link says it opens a new tab.
      expect(link?.textContent).not.toBe("Hear it on YouGlish");
      expect(dictionaryCalls()).toHaveLength(0);
    });
  });
});
