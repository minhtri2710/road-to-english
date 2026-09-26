import { afterEach, describe, expect, it } from "vitest";

import { harnessAct, hasText, renderApp, resetApp, waitForCondition } from "../test/app";

const HINT = "Paste the transcript from YouTube's Show transcript panel (timestamps included).";

const levelButton = (container: HTMLElement, name: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('form [role="group"][aria-label="Lesson level"] button')).find(
    (button) => button.textContent?.startsWith(name),
  );

describe("ImportTextForm", () => {
  afterEach(resetApp);

  it("places the transcript hint above the Text area and describes the area with it", async () => {
    const { container } = await renderApp();
    await waitForCondition(hasText(container, "Your lessons"));
    const manage = Array.from(container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Views"] a')).find((link) => link.textContent?.trim() === "Manage");
    await harnessAct(async () => { manage?.click(); });
    await waitForCondition(hasText(container, HINT));
    const textArea = container.querySelector("#import-text")!;
    const hint = document.getElementById(textArea.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toBe(HINT);
    expect(hint!.compareDocumentPosition(textArea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("defaults the level to the level filter unless it is All, and still lets the learner change it", async () => {
    const { container } = await renderApp();
    await waitForCondition(hasText(container, "Daily Routine"));
    const manage = Array.from(container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Views"] a')).find((link) => link.textContent?.trim() === "Manage");
    await harnessAct(async () => { manage?.click(); });
    expect(levelButton(container, "B1")?.getAttribute("aria-pressed")).toBe("true");

    const a2 = levelButton(container, "A2")!;
    await harnessAct(async () => {
      a2.click();
    });
    expect(levelButton(container, "A2")?.getAttribute("aria-pressed")).toBe("true");

    await harnessAct(async () => {
      levelButton(container, "B2")!.click();
    });
    expect(levelButton(container, "B2")?.getAttribute("aria-pressed")).toBe("true");
  });
});
