import { createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { click, harnessAct } from "../test/app";
import { greetingsLesson } from "../test/fixtures";
import { scoreShadow } from "../lib/shadowScore";
import { FeedbackCard, LearnTranscript, ScoreStrip, TypeInstead } from "./LearnView";

const sentences = greetingsLesson.sentences;
const roots: ReturnType<typeof createRoot>[] = [];

async function render(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await harnessAct(async () => root.render(element));
  return container;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await harnessAct(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("LearnTranscript", () => {
  it("opens each sentence once every sentence before it passed, and locks the rest", async () => {
    const onOpen = vi.fn();
    const container = await render(
      createElement(LearnTranscript, {
        sentences,
        current: 0,
        passed: new Set([sentences[0].id]),
        scores: new Map([[sentences[0].id, 86]]),
        showVietnamese: false,
        onOpen,
      }),
    );
    const items = Array.from(container.querySelectorAll("li"));
    expect(items[0].querySelector('[aria-current="step"]')).not.toBeNull();
    expect(items[0].textContent).toContain("86");
    // The second sentence is open: the first passed.
    expect(items[1].querySelector("button")?.textContent).toContain(sentences[1].text);
    // The third waits for the second; it says why, and every later one is only locked.
    expect(items[2].textContent).toContain("Reach 70 points on the sentence above to unlock this one");
    expect(items[2].textContent).not.toContain(sentences[2].text);
    expect(items[2].querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Locked");
    await harnessAct(async () => items[1].querySelector("button")!.click());
    expect(onOpen).toHaveBeenCalledWith(1);
  });
});

describe("ScoreStrip", () => {
  it("draws a bar per word, colored by level once scored", async () => {
    const container = await render(createElement(ScoreStrip, { text: "Good morning, friend.", result: null }));
    expect(container.querySelectorAll('[data-testid="score-strip"] span')).toHaveLength(3);
    const scored = await render(
      createElement(ScoreStrip, { text: "Good morning, friend.", result: scoreShadow("good morning", "Good morning, friend.") }),
    );
    expect(scored.querySelectorAll('[data-testid="score-strip"] span')).toHaveLength(3);
  });
});

describe("FeedbackCard", () => {
  it("names the worst word and what the browser heard", async () => {
    const container = await render(
      createElement(FeedbackCard, { result: scoreShadow("I've never scene everyone like it", "I've never seen anything like it."), children: null }),
    );
    expect(container.textContent).toContain('"anything" was not clear: the browser heard "everyone".');
    expect(container.textContent).toContain("1 more word to work on.");
  });

  it("looks up the pronunciation only when asked", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ word: "anything", phonetic: "/ˈɛn.i.θɪŋ/", meanings: [{ partOfSpeech: "pronoun", definitions: [{ definition: "Any thing at all." }] }] }])));
    vi.stubGlobal("fetch", fetchMock);
    const container = await render(
      createElement(FeedbackCard, { result: scoreShadow("I've never seen everyone like it", "I've never seen anything like it."), children: null }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await click(container, "Show how to say it");
    await harnessAct(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("/ˈɛn.i.θɪŋ/");
    vi.unstubAllGlobals();
  });
});

describe("TypeInstead", () => {
  it("unlocks only when every word is typed right", async () => {
    const onPassed = vi.fn();
    const container = await render(createElement(TypeInstead, { text: "Good morning, friend.", onPassed }));
    const input = container.querySelector("input")!;
    const type = async (value: string) => {
      await harnessAct(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await click(container, "Check typing");
    };
    await type("good morning");
    expect(onPassed).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Not every word matches yet.");
    await type("good morning friend");
    expect(onPassed).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Every word is right. The next sentence is open.");
  });
});
