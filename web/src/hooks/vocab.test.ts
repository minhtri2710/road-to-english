import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { VocabCard } from "../lib/vocab";
import { getAllCards } from "../lib/vocabStore";
import { useVocabDeck } from "./vocab";
import { harnessAct } from "../test/app";
import { card } from "../test/fixtures";

vi.mock("../lib/vocabStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/vocabStore")>()),
  getAllCards: vi.fn(),
}));

function Probe() {
  const deck = useVocabDeck();
  return createElement("output", null, deck.loading ? "loading" : [...deck.savedCardIds].join(","));
}

afterEach(() => {
  vi.mocked(getAllCards).mockReset();
});

describe("useVocabDeck", () => {
  it("ignores a superseded refresh that resolves last", async () => {
    const pending: ((cards: VocabCard[]) => void)[] = [];
    vi.mocked(getAllCards).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const container = document.createElement("div");
    const root = createRoot(container);
    await harnessAct(async () => {
      root.render(createElement(StrictMode, null, createElement(Probe)));
    });
    await harnessAct(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    const latest = pending.length - 1;
    await harnessAct(async () => {
      pending[latest]([card("new")]);
    });
    expect(container.textContent).toBe("lesson-1:new");
    await harnessAct(async () => {
      pending.slice(0, latest).forEach((resolve) => resolve([card("stale")]));
    });
    expect(container.textContent).toBe("lesson-1:new");
    await harnessAct(async () => {
      root.unmount();
    });
  });
});
