import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { createLesson, expect, menuItem, openLibraryLesson, test, TRANSCRIPT } from "./fixtures";

const LESSON = "Greetings & Basics";
const FIRST = "Good morning, how are you today?";

async function axe(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`));
}

async function say(page: Page, transcript: string): Promise<void> {
  await page.evaluate((text) => {
    (window as unknown as { __speechTranscript: string }).__speechTranscript = text;
  }, transcript);
}

async function openGuided(page: Page, { pronunciation }: { pronunciation: boolean }): Promise<void> {
  await openLibraryLesson(page, LESSON);
  if (pronunciation) {
    await (await menuItem(page, "Pronunciation check")).click();
    await page.getByRole("button", { name: "Enable" }).click();
  }
  await (await menuItem(page, "One at a time")).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 2, name: "Sentence 1 of 9" })).toBeVisible();
}

const gate = (page: Page) => page.getByRole("region", { name: "Shadow Gate" });
const next = (page: Page) => page.getByRole("button", { name: "Next", exact: true });

test.describe("Learn mode", () => {
  test("needs Pronunciation check, and says so", async ({ page }) => {
    await openGuided(page, { pronunciation: false });
    await expect(page.getByText("Turn on Pronunciation check in Display to use it.")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Learn" })).toBeDisabled();
    await expect(gate(page)).toHaveCount(0);
  });

  test("locks Next until the sentence scores 70, and scores each word", async ({ page }) => {
    await openGuided(page, { pronunciation: true });
    await page.getByRole("radio", { name: "Learn" }).click();
    await expect(gate(page)).toBeVisible();
    await expect(next(page)).toBeDisabled();
    // The card's own check gives way to the gate's speak button.
    await expect(page.getByRole("button", { name: "Check pronunciation" })).toHaveCount(0);

    await say(page, "good morning");
    await gate(page).getByRole("button", { name: "Say the sentence" }).click();
    await expect(gate(page).getByRole("img", { name: "Score 33 of 100" })).toBeVisible();
    await expect(gate(page).getByText("Not yet · 33 points")).toBeVisible();
    await expect(gate(page).getByText("today (missed)")).toBeAttached();
    await expect(next(page)).toBeDisabled();
    expect(await axe(page)).toEqual([]);

    await gate(page).getByRole("button", { name: "Try again" }).click();
    await expect(gate(page).getByRole("button", { name: "Say the sentence" })).toBeFocused();
    await say(page, "good morning how are you today");
    await gate(page).getByRole("button", { name: "Say the sentence" }).click();
    await expect(gate(page).getByText("Unlocked · 100 points")).toBeVisible();
    await expect(next(page)).toBeEnabled();
    await next(page).click();
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 2 of 9" })).toBeFocused();
    await expect(next(page)).toBeDisabled();

    // Going back keeps the first sentence unlocked for this visit.
    await page.getByRole("button", { name: "Previous" }).click();
    await expect(gate(page).getByText("Unlocked", { exact: true })).toBeVisible();
    await expect(next(page)).toBeEnabled();
  });

  test("does not jump forward when a sentence passes while the clamped cursor came from Free mode", async ({ page }) => {
    await openGuided(page, { pronunciation: true });
    // Free mode moves to sentence 3; Learn mode opens only the committed prefix, so the cursor clamps back.
    await next(page).click();
    await next(page).click();
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 3 of 9" })).toBeVisible();
    await page.getByRole("radio", { name: "Learn" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 1 of 9" })).toBeVisible();

    await say(page, FIRST);
    await gate(page).getByRole("button", { name: "Say the sentence" }).click();
    await expect(gate(page).getByText("Unlocked · 100 points")).toBeVisible();
    // The pass widened the open edge; a stale sentence-3 request must not take the view forward.
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 1 of 9" })).toBeVisible();
    await expect(next(page)).toBeEnabled();
  });

  test("allows three skips per lesson", async ({ page }) => {
    await openGuided(page, { pronunciation: true });
    await page.getByRole("radio", { name: "Learn" }).click();
    for (const [left, sentence] of [[3, 2], [2, 3], [1, 4]] as const) {
      await page.getByRole("button", { name: `Skip (${left} of 3 left)` }).click();
      await expect(page.getByRole("heading", { level: 2, name: `Sentence ${sentence} of 9` })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Skip (0 of 3 left)" })).toBeDisabled();
    await expect(next(page)).toBeDisabled();
  });

  test("shows zero skips and still allows a pass when stored skips exceed the cap", async ({ page }) => {
    // An imported row can carry more skips than the lesson's budget: clamp the display, keep passes working.
    await page.goto("/");
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("road-to-english");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction("learnProgress", "readwrite");
      tx.objectStore("learnProgress").put({
        lessonId: "greetings-basics",
        passed: [],
        skipsUsed: 7,
        updatedAt: new Date().toISOString(),
      });
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.getByRole("button", { name: LESSON }).click();
    await (await menuItem(page, "Pronunciation check")).click();
    await page.getByRole("button", { name: "Enable" }).click();
    await (await menuItem(page, "One at a time")).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 1 of 9" })).toBeVisible();
    await page.getByRole("radio", { name: "Learn" }).click();
    await expect(page.getByText("Unlocked 0 of 9 sentences · 0 of 3 skips left. Saved on this device.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip (0 of 3 left)" })).toBeDisabled();
    await say(page, FIRST);
    await gate(page).getByRole("button", { name: "Say the sentence" }).click();
    await expect(gate(page).getByText("Unlocked · 100 points")).toBeVisible();
    await expect(next(page)).toBeEnabled();
  });

  test("keeps Learn mode, unlocked sentences and skips after a reload, until Start over", async ({ page }) => {
    await openGuided(page, { pronunciation: true });
    await page.getByRole("radio", { name: "Learn" }).click();
    await say(page, FIRST);
    await gate(page).getByRole("button", { name: "Say the sentence" }).click();
    await expect(gate(page).getByText("Unlocked · 100 points")).toBeVisible();
    await next(page).click();
    await page.getByRole("button", { name: "Skip (3 of 3 left)" }).click();
    await expect(page.getByText("Unlocked 2 of 9 sentences · 2 of 3 skips left. Saved on this device.")).toBeVisible();

    await page.reload();
    await openGuided(page, { pronunciation: false });
    await expect(page.getByRole("radio", { name: "Learn" })).toBeChecked();
    await expect(next(page)).toBeEnabled();
    await expect(page.getByText("Unlocked 2 of 9 sentences · 2 of 3 skips left. Saved on this device.")).toBeVisible();

    // Forward to the open edge: the cursor Start over must clear back to sentence 1.
    await next(page).click();
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 2 of 9" })).toBeVisible();
    await next(page).click();
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 3 of 9" })).toBeVisible();
    await expect(next(page)).toBeDisabled();

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 1 of 9" })).toBeVisible();
    await expect(page.getByText("Unlocked 0 of 9 sentences · 3 of 3 skips left. Saved on this device.")).toBeVisible();
    await expect(next(page)).toBeDisabled();
    await expect(page.getByRole("complementary", { name: "Transcript" }).getByRole("img", { name: "Locked" })).toHaveCount(8);
  });

  test("the Learn view fits a 320px screen at 200% text", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await openGuided(page, { pronunciation: true });
    await page.getByRole("radio", { name: "Learn" }).click();
    await say(page, "good morning");
    await gate(page).getByRole("button", { name: "Say the sentence" }).click();
    await expect(gate(page).getByText("Not yet · 33 points")).toBeVisible();
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });

  test("shows the stage, the transcript with locked lines, and feedback for an unclear word", async ({ page }) => {
    await openGuided(page, { pronunciation: true });
    await page.getByRole("radio", { name: "Learn" }).click();
    const stage = page.getByRole("region", { name: "Sentence stage" });
    await expect(stage).toContainText(FIRST);
    await expect(stage.getByRole("button", { name: "0.75×" })).toHaveAttribute("aria-pressed", "false");
    await stage.getByRole("button", { name: "0.75×" }).click();
    await expect(stage.getByRole("button", { name: "0.75×" })).toHaveAttribute("aria-pressed", "true");

    const transcript = page.getByRole("complementary", { name: "Transcript" });
    await expect(transcript.getByRole("listitem")).toHaveCount(9);
    await expect(transcript.getByText("Reach 70 points on the sentence above to unlock this one")).toBeVisible();
    await expect(transcript.getByRole("img", { name: "Locked" })).toHaveCount(8);

    await say(page, "good morning how our you");
    await gate(page).getByRole("button", { name: "Say the sentence" }).click();
    await expect(page.getByTestId("feedback-card")).toContainText('"are" was not clear: the browser heard "our".');
    await expect(transcript.getByRole("listitem").first()).toContainText("67");
    expect(await axe(page)).toEqual([]);
  });

  test("typing the sentence instead unlocks it", async ({ page }) => {
    await openGuided(page, { pronunciation: true });
    await page.getByRole("radio", { name: "Learn" }).click();
    await page.getByText("Can't speak right now? Type it instead").click();
    await page.getByLabel("Type the sentence you heard. Getting every word right unlocks the next one.").fill(
      "good morning how are you today",
    );
    await page.getByRole("button", { name: "Check typing" }).click();
    await expect(gate(page).getByText("Unlocked", { exact: true })).toBeVisible();
    await expect(next(page)).toBeEnabled();
  });

  test("shows a load error for Learn progress and recovers with Try again", async ({ page }) => {
    // Fail reads of the learnProgress store until the flag is lifted: React StrictMode mounts the hook twice,
    // so a one-shot failure would be consumed by the discarded mount's read.
    await page.addInitScript(() => {
      const original = IDBDatabase.prototype.transaction;
      (window as unknown as { __failLearnReads: boolean }).__failLearnReads = true;
      IDBDatabase.prototype.transaction = function (
        this: IDBDatabase,
        ...args: Parameters<IDBDatabase["transaction"]>
      ) {
        if (
          (window as unknown as { __failLearnReads?: boolean }).__failLearnReads &&
          args[0] === "learnProgress" &&
          args[1] !== "readwrite"
        ) {
          throw new DOMException("injected read failure");
        }
        return original.apply(this, args);
      };
    });
    await openGuided(page, { pronunciation: true });
    await page.getByRole("radio", { name: "Learn" }).click();
    await expect(page.getByRole("alert")).toHaveText("Couldn't load Learn progress.");
    await expect(gate(page)).toHaveCount(0);
    await page.evaluate(() => {
      delete (window as unknown as { __failLearnReads?: boolean }).__failLearnReads;
    });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Unlocked 0 of 9 sentences · 3 of 3 skips left. Saved on this device.")).toBeVisible();
    await expect(gate(page)).toBeVisible();
  });

  test("keeps the score but not the unlock when saving Learn progress fails, then retries", async ({ page }) => {
    await openGuided(page, { pronunciation: true });
    // Abort a real learnProgress readwrite transaction after its put was issued, so both the request and the
    // transaction reject inside applyLearnChange — and no request promise rejects unobserved.
    await page.evaluate(() => {
      const rejections: string[] = [];
      window.addEventListener("unhandledrejection", (event) => rejections.push(String(event.reason)));
      (window as unknown as { __learnRejections: string[] }).__learnRejections = rejections;
      const original = IDBObjectStore.prototype.put;
      let armed = true;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
        if (armed && this.name === "learnProgress" && this.transaction.mode === "readwrite") {
          armed = false;
          const request = original.apply(this, args);
          this.transaction.abort();
          return request;
        }
        return original.apply(this, args);
      };
    });
    await page.getByRole("radio", { name: "Learn" }).click();
    await expect(page.getByText("Unlocked 0 of 9 sentences · 3 of 3 skips left. Saved on this device.")).toBeVisible();

    await say(page, FIRST);
    await gate(page).getByRole("button", { name: "Say the sentence" }).click();
    await expect(gate(page).getByRole("img", { name: "Score 100 of 100" })).toBeVisible();
    await expect(gate(page).getByText("100 points")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveText("Couldn't save Learn progress.");
    await expect(gate(page).getByText(/Unlocked/)).toHaveCount(0);
    await expect(next(page)).toBeDisabled();

    expect(await page.evaluate(() => (window as unknown as { __learnRejections: string[] }).__learnRejections)).toEqual([]);

    await page.getByRole("button", { name: "Retry save" }).click();
    await expect(gate(page).getByText("Unlocked · 100 points")).toBeVisible();
    await expect(next(page)).toBeEnabled();
    expect(await page.evaluate(() => (window as unknown as { __learnRejections: string[] }).__learnRejections)).toEqual([]);

    await page.reload();
    await openGuided(page, { pronunciation: false });
    await expect(page.getByText("Unlocked 1 of 9 sentences · 3 of 3 skips left. Saved on this device.")).toBeVisible();
    await expect(next(page)).toBeEnabled();
  });

  test("keyboard shortcuts act inside the guided view only", async ({ page }) => {
    await openGuided(page, { pronunciation: true });
    await page.getByRole("radio", { name: "Learn" }).click();
    await say(page, FIRST);
    await page.getByRole("heading", { level: 2, name: "Sentence 1 of 9" }).focus();

    await page.keyboard.press("l");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toContain(FIRST);
    await page.keyboard.press("r");
    await expect(gate(page).getByText("Unlocked · 100 points")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 2 of 9" })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 1 of 9" })).toBeVisible();

    // Outside the guided view the same key does nothing.
    await page.getByRole("button", { name: "Back to lessons" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("heading", { level: 2, name: "Sentence 1 of 9" })).toBeVisible();
  });
});

test("a played video clip is captioned under the player and its sentence is marked", async ({ page }) => {
  await createLesson(page, { title: "Captioned video", text: TRANSCRIPT, videoUrl: "https://youtu.be/dQw4w9WgXcQ" });
  const clips = page.getByRole("button", { name: "Play clip" });
  await expect(clips.nth(1)).toBeEnabled();
  await expect(page.getByTestId("video-caption")).toHaveCount(0);
  await clips.nth(1).click();
  await expect(page.getByTestId("video-caption")).toHaveText("This is the second line.");
  await expect(page.locator("[data-active]")).toHaveCount(1);
  await expect(page.locator("[data-active]")).toContainText("This is the second line.");
});

test.describe("How it works page", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`has no axe violations in ${colorScheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/#/about");
      await expect(page.getByRole("heading", { level: 1, name: "Listen. Say it back. Level up." })).toBeVisible();
      await expect(page.getByRole("button", { name: "About Me" })).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });
  }

  test("is reached from the footer and starts practice in the library", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "How it works" }).click();
    await expect(page).toHaveURL(/#\/about$/);
    await expect(page.getByRole("heading", { level: 1, name: "Listen. Say it back. Level up." })).toBeFocused();
    await page.getByRole("button", { name: "Start practising" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Lesson library" })).toBeVisible();
  });

  test("fits a 320px screen at 200% text", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/#/about");
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});

test("a finished recording is drawn as a waveform beside its player, with a score from its sound", async ({ page }) => {
  await openLibraryLesson(page, LESSON);
  const card = page.getByRole("listitem").filter({ hasText: FIRST });
  await card.getByRole("button", { name: "Record" }).click();
  await page.waitForTimeout(1500);
  await card.getByRole("button", { name: "Stop" }).click();
  await expect(card.getByRole("button", { name: "Record" })).toBeVisible();
  await expect(card.getByTestId("recording-waveform")).toBeVisible();
  await expect(card.getByTestId("recording-waveform").locator("span")).toHaveCount(48);
  await expect(card.getByTestId("sound-score")).toContainText(/^Sound check \d+: \d+ WPM, target 90, (a little slow|on pace|a little fast)/);
});
