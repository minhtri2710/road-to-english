import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as backupStore from "../lib/backupStore";
import { exportData } from "../lib/backup";
import { cardsCsv } from "../lib/csv";
import { todayKey } from "../lib/progress";
import { getPracticeDays, recordPractice } from "../lib/progressStore";
import { createCard } from "../lib/vocab";
import { getAllCards, putCard } from "../lib/vocabStore";
import {
  buttonsNamed,
  click,
  hasText,
  renderApp,
  resetApp,
  userResponse,
  waitForCondition,
} from "../test/app";

describe("BackupControls", () => {
  afterEach(resetApp);

  async function importConfirmText(signedIn: boolean): Promise<string> {
    const confirm = vi.fn<(message?: string) => boolean>(() => false);
    vi.stubGlobal("confirm", confirm);
    const { container, unmount } = await renderApp({ route: (path) => (path === "/me" && signedIn ? userResponse() : undefined) });
    if (signedIn) {
      await waitForCondition(() => container.textContent?.includes("restored@example.com") ?? false);
    }
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("backup file input not found");
    const text = exportData({ cards: [], practiceDays: [], lessonCompletion: [], userLessons: [] }, new Date());
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File([text], "backup.json", { type: "application/json" })],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitForCondition(() => confirm.mock.calls.length === 1);
    await unmount();
    return confirm.mock.calls[0]?.[0] ?? "";
  }

  it("exports all stored cards as a CSV download", async () => {
    await putCard(
      createCard(
        { front: 'say "hi"', back: "chào, bạn", source: { lessonId: "l", sentenceId: "s", word: "" } },
        new Date(),
      ),
    );
    const blobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:csv";
      }),
    });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    const { container } = await renderApp();

    await act(async () => {
      buttonsNamed(container, "Export CSV")[0]?.click();
    });
    await waitForCondition(() => downloads.length > 0);

    expect(blobs).toHaveLength(1);
    expect(blobs[0]?.type).toBe("text/csv;charset=utf-8");
    expect(await blobs[0]?.text()).toBe(cardsCsv(await getAllCards()));
    expect(downloads).toEqual([`road-to-english-cards-${todayKey(new Date())}.csv`]);
  });

  it("imports a backup through the UI and refreshes the deck and streak", async () => {
    const existing = createCard(
      {
        front: "old card",
        back: "old answer",
        source: { lessonId: "old-lesson", sentenceId: "old-sentence", word: "" },
      },
      new Date(),
    );
    await putCard(existing);
    await recordPractice("2025-01-01", { newCard: false });

    const importedCard = createCard(
      {
        front: "imported card",
        back: "imported answer",
        source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "" },
      },
      new Date(),
    );
    const text = exportData(
      {
        cards: [importedCard],
        practiceDays: [{ date: todayKey(new Date()) }],
        lessonCompletion: [{ lessonId: "lesson-1" }],
        userLessons: [],
      },
      new Date(),
    );
    vi.stubGlobal("confirm", () => true);
    const { container } = await renderApp();
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    if (!input) throw new Error("backup file input not found");

    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File([text], "backup.json", { type: "application/json" })],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitForCondition(() => container.textContent?.includes("1-day streak") ?? false);

    expect(container.textContent).toContain("1-day streak");
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Review"))
        ?.click();
    });
    await waitForCondition(() => container.textContent?.includes("imported card") ?? false);
    expect(container.textContent).toContain("imported card");
    expect(container.textContent).not.toContain("old card");
    expect(await getAllCards()).toHaveLength(1);
    expect(await getPracticeDays()).toHaveLength(1);
  });

  it("clears a backup error on the next successful export", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:backup") });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.spyOn(backupStore, "exportBackupData").mockRejectedValueOnce(new Error("export broke"));
    const { container } = await renderApp();
    await click(container, "Export");
    await waitForCondition(hasText(container, "Backup error: export broke"));
    await click(container, "Export");
    await waitForCondition(() => !hasText(container, "Backup error")());
    await click(container, "Export CSV");
    expect(container.textContent).not.toContain("Backup error");
  });

  it("words the import confirm for signed-out and signed-in users", async () => {
    expect(await importConfirmText(false)).toBe(
      "Importing this backup will replace all local data on this device. Continue?",
    );
    expect(await importConfirmText(true)).toBe(
      "Importing this backup will replace all local data on this device. Your next sync merges it with your account, so cards and progress already in your account stay. Continue?",
    );
  });
});
