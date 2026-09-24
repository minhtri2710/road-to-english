import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";

import {
  ACCOUNT_PASSWORD,
  accountDisclosure,
  accountModes,
  attemptEverySentence,
  createLesson,
  expect,
  limitLogin,
  missOneWord,
  openAccountForm,
  openLibraryLesson,
  submitAccount,
  test,
  TRANSCRIPT,
  uniqueEmail,
} from "./fixtures";

const LIBRARY_LESSON = "Greetings & Basics";
const USER_LESSON = "My pasted text";

async function axeViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`),
  );
}

async function createUserLesson(page: Page): Promise<void> {
  await createLesson(page, { title: USER_LESSON, text: "The first sentence is short. The second one follows." });
  await expect(page.getByRole("heading", { level: 1, name: USER_LESSON })).toBeVisible();
  await page.getByRole("button", { name: "Back to lessons" }).click();
  await expect(page.getByRole("button", { name: `Delete ${USER_LESSON}` })).toBeVisible();
  await expect(page.getByRole("button", { name: LIBRARY_LESSON })).toBeVisible();
}

async function selectWord(page: Page): Promise<void> {
  await openLibraryLesson(page, LIBRARY_LESSON);
  await page.getByRole("button", { name: "morning", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save word" })).toBeVisible();
}

async function openReviewWithDueCard(page: Page): Promise<void> {
  await selectWord(page);
  await page.getByRole("button", { name: "Save word" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toHaveAccessibleName("Saved, remove from review deck");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("1 due")).toBeVisible();
}

async function showImportError(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("button", { name: LIBRARY_LESSON })).toBeVisible();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText(/^Title must be/)).toBeVisible();
}

async function checkDictationWithHint(page: Page): Promise<void> {
  await openLibraryLesson(page, LIBRARY_LESSON);
  await page.getByRole("button", { name: "Dictation" }).click();
  await page.getByRole("button", { name: "Show hint" }).first().click();
  await page.getByLabel("What did you hear?").first().fill("Good, how are you tomorrow?");
  await page.getByRole("button", { name: "Check" }).first().click();
  await expect(page.getByRole("button", { name: "Hear morning" })).toBeVisible();
}

async function openA1WordBank(page: Page): Promise<void> {
  await openLibraryLesson(page, "About Me");
  await page.getByRole("button", { name: "Fill the blank" }).click();
  await expect(page.getByRole("group", { name: "Choose a word" }).first()).toBeVisible();
}

async function hideFirstSentenceText(page: Page): Promise<void> {
  await openLibraryLesson(page, LIBRARY_LESSON);
  const text = page.getByRole("button", { name: "Text", exact: true }).first();
  await text.click();
  await expect(text).toHaveAttribute("aria-pressed", "false");
}

async function openVideoLesson(page: Page): Promise<void> {
  await createLesson(page, {
    title: "Video lesson",
    text: TRANSCRIPT,
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
  await expect(page.getByRole("button", { name: "Play clip" }).first()).toBeEnabled();
}

async function showCollapsedAccount(page: Page): Promise<void> {
  await page.goto("/");
  await expect(accountDisclosure(page)).toHaveAttribute("aria-expanded", "false");
}

async function openSignIn(page: Page): Promise<void> {
  await showCollapsedAccount(page);
  await openAccountForm(page);
}

async function openCreateAccount(page: Page): Promise<void> {
  await openSignIn(page);
  await accountModes(page).getByRole("radio", { name: "Create account" }).click();
  await expect(page.getByText("At least 8 characters.")).toBeVisible();
}

async function showAccountFieldError(page: Page): Promise<void> {
  await page.goto("/");
  await submitAccount(page, "Create account", uniqueEmail(), "short");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("aria-invalid", "true");
}

async function showAccountCountdown(page: Page): Promise<void> {
  await limitLogin(page, "90");
  await page.goto("/");
  await submitAccount(page, "Sign in", uniqueEmail(), ACCOUNT_PASSWORD);
  await expect(page.locator("p:not([role=alert])", { hasText: "Too many attempts. Try again in 2 min" })).toBeVisible();
}

const FREEZE_HELP = "A freeze keeps your streak when you miss one day. You earn one for every 7 days in a row, up to 2.";
const STORAGE_BANNER = "Progress saved only in this browser";
const STORAGE_MAY_CLEAR = "This browser may clear your saved progress when space is low. Export a backup or sign in to keep it.";

// Fixes what navigator.storage.persist() answers, so both storage states are reachable in one browser.
async function grantPersistence(page: Page, granted: boolean): Promise<void> {
  await page.addInitScript((kept) => {
    Object.defineProperty(navigator.storage, "persist", { configurable: true, value: () => Promise.resolve(kept) });
  }, granted);
}

function todayCard(page: Page) {
  return page.getByRole("heading", { name: "Today" }).locator("xpath=../..");
}

async function practiseOnce(page: Page): Promise<void> {
  await openLibraryLesson(page, LIBRARY_LESSON);
  await page.getByRole("button", { name: "Dictation" }).click();
  await page.getByLabel("What did you hear?").first().fill("Good morning");
  await page.getByRole("button", { name: "Check" }).first().click();
  await expect(page.getByText(/^Reference:/).first()).toBeVisible();
  await page.getByRole("button", { name: "Back to lessons" }).click();
  await expect(todayCard(page).getByText("1-day streak")).toBeVisible();
}

async function showLibraryTop(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "About Me" })).toBeVisible();
  await expect(todayCard(page).getByText("Start a new streak today")).toBeVisible();
}

async function openFreezeTooltip(page: Page): Promise<void> {
  await practiseOnce(page);
  // From the top, Tab reaches the Today card before the Level control and its keyboard hint.
  await page.reload();
  await expect(todayCard(page).getByText("1-day streak")).toBeVisible();
  await tabTo(page, page.getByText("Freezes 0 of 2"));
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toHaveText(FREEZE_HELP);
  // Axe measures contrast as drawn, so wait until the tooltip has finished appearing: full opacity, no animation left.
  await expect.poll(() => tooltip.evaluate((el) => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (getComputedStyle(node).opacity !== "1" || node.getAnimations().some((animation) => animation.playState === "running")) {
        return false;
      }
    }
    return true;
  })).toBe(true);
}

async function showStorageBanner(page: Page): Promise<void> {
  await grantPersistence(page, false);
  await page.goto("/");
  await expect(page.locator("header").getByText(STORAGE_BANNER)).toBeVisible();
  await expect(page.getByRole("region", { name: "Your data" }).getByText(STORAGE_MAY_CLEAR)).toHaveCount(1);
}

async function showYourData(page: Page): Promise<void> {
  await grantPersistence(page, true);
  await page.goto("/");
  const yourData = page.getByRole("region", { name: "Your data" });
  await expect(yourData.getByText("Storage: kept on this device.")).toBeVisible();
  await yourData.scrollIntoViewIfNeeded();
}

async function showSyncLine(page: Page): Promise<void> {
  await page.goto("/");
  await submitAccount(page, "Create account", uniqueEmail(), ACCOUNT_PASSWORD);
  await expect(page.getByText("Synced just now")).toBeVisible();
}

// The real api answers, then the response's status becomes `status`; the api's own CORS headers stay.
async function answerWithStatus(page: Page, path: string, status: number): Promise<void> {
  await page.route(`**${path}`, async (route) => {
    const response = await route.fetch();
    return route.fulfill({ response, status });
  });
}

// Runs the app's own store modules in the page, served by the dev server, then reloads so the app reads the result.
async function seedStore(page: Page, seed: "dueCards" | "newCardLimit" | "goalMet"): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("button", { name: LIBRARY_LESSON })).toBeVisible();
  await page.evaluate(async (which) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { createCard } = await load("/src/lib/vocab.ts");
    const { putCard } = await load("/src/lib/vocabStore.ts");
    const { todayKey } = await load("/src/lib/progress.ts");
    const { recordPractice } = await load("/src/lib/progressStore.ts");
    const words = which === "dueCards" ? ["able", "bake"] : which === "newCardLimit" ? ["calm"] : [];
    for (const [index, word] of words.entries()) {
      await putCard(createCard({ front: word, back: `The ${word} one.`, source: { lessonId: "greetings-basics", sentenceId: `seed-${index}`, word } }, new Date()));
    }
    // 20 new cards introduced today reach the daily limit; 5 actions meet a goal of 5.
    const actions = which === "newCardLimit" ? 20 : which === "goalMet" ? 5 : 0;
    if (which === "goalMet") localStorage.setItem("road-to-english.dailyGoal", "5");
    for (let index = 0; index < actions; index += 1) {
      await recordPractice(todayKey(new Date()), { newCard: which === "newCardLimit" });
    }
  }, seed);
  await page.reload();
}

async function selectDictionaryWord(page: Page, answer: (route: Route) => Promise<void>): Promise<void> {
  await page.route("https://api.dictionaryapi.dev/**", answer);
  await selectWord(page);
  await page.getByRole("button", { name: "Define" }).click();
}

async function openRecordingReady(page: Page): Promise<void> {
  await openLibraryLesson(page, LIBRARY_LESSON);
  await page.getByRole("button", { name: "Record" }).first().click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Compare" }).first()).toBeEnabled();
}

async function openGuided(page: Page): Promise<void> {
  await openLibraryLesson(page, LIBRARY_LESSON);
  await page.getByRole("button", { name: "One at a time" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Sentence 1 of 9" })).toBeVisible();
}

async function signUpWithSync(page: Page, status: number): Promise<void> {
  await answerWithStatus(page, "/sync", status);
  await page.goto("/");
  await submitAccount(page, "Create account", uniqueEmail(), ACCOUNT_PASSWORD);
}

// Each state is reached through the UI and yields once so the caller can inspect it.
const STATES: [string, (page: Page, inspect: () => Promise<void>) => Promise<void>][] = [
  ["library list with a user lesson", async (page, inspect) => {
    await createUserLesson(page);
    await inspect();
  }],
  ["library filtered by level with progress, Continue and the own-lessons empty state", async (page, inspect) => {
    await openLibraryLesson(page, "Daily Routine");
    await page.getByRole("button", { name: "Back to lessons" }).click();
    await page.getByRole("radio", { name: "B1" }).click();
    await expect(page.getByText("B1: 0 of 7 completed")).toBeVisible();
    await expect(page.getByText("Continue: Daily Routine")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No lessons of your own yet" })).toBeVisible();
    await inspect();
  }],
  ["Today card with a streak and the freezes tooltip open", async (page, inspect) => {
    await openFreezeTooltip(page);
    await inspect();
  }],
  ["storage banner", async (page, inspect) => {
    await showStorageBanner(page);
    await inspect();
  }],
  ["Your data with storage kept", async (page, inspect) => {
    await showYourData(page);
    await inspect();
  }],
  ["shadow mode with a word selected", async (page, inspect) => {
    await selectWord(page);
    await inspect();
  }],
  ["dictation mode", async (page, inspect) => {
    await openLibraryLesson(page, LIBRARY_LESSON);
    await page.getByRole("button", { name: "Dictation" }).click();
    await expect(page.getByLabel("What did you hear?").first()).toBeVisible();
    await inspect();
  }],
  ["blank mode", async (page, inspect) => {
    await openLibraryLesson(page, LIBRARY_LESSON);
    await page.getByRole("button", { name: "Fill the blank" }).click();
    await expect(page.getByLabel("Which word fills the blank?").first()).toBeVisible();
    await inspect();
  }],
  ["dictation result with the hint and diff word buttons", async (page, inspect) => {
    await checkDictationWithHint(page);
    await inspect();
  }],
  ["A1 blank with the word bank", async (page, inspect) => {
    await openA1WordBank(page);
    await inspect();
  }],
  ["shadow mode with one sentence's text hidden", async (page, inspect) => {
    await hideFirstSentenceText(page);
    await inspect();
  }],
  ["pronunciation disclosure open", async (page, inspect) => {
    await openLibraryLesson(page, LIBRARY_LESSON);
    await page.getByRole("button", { name: "Pronunciation check" }).click();
    await expect(page.getByRole("button", { name: "Enable" })).toBeVisible();
    await inspect();
  }],
  ["review with a due card", async (page, inspect) => {
    await openReviewWithDueCard(page);
    await inspect();
    await page.getByRole("button", { name: "Show answer" }).click();
    await expect(page.getByRole("button", { name: "Good" })).toBeVisible();
    await inspect();
  }],
  ["review with Listen first, before and after Show answer", async (page, inspect) => {
    await openReviewWithDueCard(page);
    await page.getByRole("button", { name: "Listen first" }).click();
    await expect(page.getByText("Listen and recall the card.")).toBeVisible();
    await inspect();
    await page.getByRole("button", { name: "Show answer" }).click();
    await expect(page.getByRole("button", { name: "Good" })).toBeVisible();
    await inspect();
  }],
  ["review Say it result", async (page, inspect) => {
    await openLibraryLesson(page, LIBRARY_LESSON);
    await page.getByRole("button", { name: "Pronunciation check" }).click();
    await page.getByRole("button", { name: "Enable" }).click();
    await page.getByRole("button", { name: "morning", exact: true }).click();
    await page.getByRole("button", { name: "Save word" }).click();
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.evaluate(() => {
      (window as unknown as { __speechTranscript: string }).__speechTranscript = "evening";
    });
    await page.getByRole("button", { name: "Say it" }).click();
    await expect(page.getByText("The browser matched 0 of 1 words")).toBeVisible();
    await inspect();
  }],
  ["review with a sentence card's Vietnamese back", async (page, inspect) => {
    await openLibraryLesson(page, LIBRARY_LESSON);
    await page.getByRole("button", { name: "Save to review" }).first().click();
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: "Show answer" }).click();
    await expect(page.locator('[lang="vi"]')).toBeVisible();
    await inspect();
  }],
  ["review recap with a card rated Again", async (page, inspect) => {
    await openReviewWithDueCard(page);
    await page.getByRole("button", { name: "Show answer" }).click();
    await page.getByRole("button", { name: "Again" }).click();
    await expect(page.getByRole("heading", { name: "Rated Again" })).toBeVisible();
    await inspect();
  }],
  ["review with nothing to review", async (page, inspect) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(page.getByText(/^Nothing to review yet/)).toBeVisible();
    await inspect();
  }],
  ["library when the lessons fetch fails, with Retry", async (page, inspect) => {
    await page.route("**/lessons", (route) => route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*" } }));
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await inspect();
  }],
  ["library while the lessons load", async (page, inspect) => {
    await page.route("**/lessons", () => undefined);
    await page.goto("/");
    await expect(page.getByText("Loading lessons...")).toBeVisible();
    await inspect();
  }],
  ["library with no lessons at the chosen level", async (page, inspect) => {
    await page.route("**/lessons", async (route) => {
      const response = await route.fetch();
      const lessons = (await response.json()) as { level: string }[];
      return route.fulfill({ response, json: lessons.filter((lesson) => lesson.level !== "B2") });
    });
    await page.goto("/");
    await page.getByRole("radio", { name: "B2" }).click();
    await expect(page.getByText("No lessons at this level.")).toBeVisible();
    await inspect();
  }],
  ["Today card with cards due", async (page, inspect) => {
    await seedStore(page, "dueCards");
    await expect(todayCard(page).getByRole("button", { name: "Review 2 cards" })).toBeVisible();
    await inspect();
  }],
  ["Today card with the daily goal met", async (page, inspect) => {
    await seedStore(page, "goalMet");
    await expect(todayCard(page).getByText("5 of 5 practice actions today · Daily goal met")).toBeVisible();
    await inspect();
  }],
  ["lesson unavailable", async (page, inspect) => {
    await page.goto("/#/lesson/no-such-lesson");
    await expect(page.getByRole("heading", { level: 1, name: "Lesson unavailable" })).toBeVisible();
    await inspect();
  }],
  ["lesson with Vietnamese shown", async (page, inspect) => {
    await openLibraryLesson(page, LIBRARY_LESSON);
    const vietnamese = page.getByRole("button", { name: "Vietnamese" });
    await vietnamese.click();
    await expect(vietnamese).toHaveAttribute("aria-pressed", "true");
    await inspect();
  }],
  ["recording ready with Compare", async (page, inspect) => {
    await openRecordingReady(page);
    await inspect();
  }],
  ["guided shadowing with text shown", async (page, inspect) => {
    await openGuided(page);
    await inspect();
  }],
  ["guided shadowing with text hidden", async (page, inspect) => {
    await openGuided(page);
    const text = page.getByRole("button", { name: "Text", exact: true });
    await text.click();
    await expect(text).toHaveAttribute("aria-pressed", "false");
    await inspect();
  }],
  ["guided shadowing with a recording ready", async (page, inspect) => {
    await openGuided(page);
    await page.getByRole("button", { name: "Record" }).click();
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByRole("button", { name: "Compare" })).toBeEnabled();
    await inspect();
  }],
  ["guided shadowing at the last sentence", async (page, inspect) => {
    await openGuided(page);
    for (let sentence = 2; sentence <= 9; sentence += 1) {
      await page.getByRole("button", { name: "Next" }).click();
      await expect(page.getByRole("heading", { level: 2, name: `Sentence ${sentence} of 9` })).toBeVisible();
    }
    await inspect();
  }],
  ["pronunciation check unsupported", async (page, inspect) => {
    await page.addInitScript(() => {
      for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
        Object.defineProperty(window, name, { configurable: false, get: () => undefined, set: () => undefined });
      }
    });
    await openLibraryLesson(page, LIBRARY_LESSON);
    await expect(page.getByText("Pronunciation check disabled: speech recognition is not supported in this browser.")).toBeVisible();
    await inspect();
  }],
  ["blank result Not quite", async (page, inspect) => {
    await openLibraryLesson(page, LIBRARY_LESSON);
    await page.getByRole("button", { name: "Fill the blank" }).click();
    await page.getByLabel("Which word fills the blank?").first().fill("evening");
    await page.getByRole("button", { name: "Check" }).first().click();
    await expect(page.getByText("Not quite — the word was morning")).toBeVisible();
    await inspect();
  }],
  ["dictation after Try again", async (page, inspect) => {
    await checkDictationWithHint(page);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByLabel("What did you hear?").first()).toHaveValue("");
    await inspect();
  }],
  ["word panel with a definition", async (page, inspect) => {
    await selectDictionaryWord(page, (route) =>
      route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        json: [{ word: "morning", phonetic: "/ˈmɔːnɪŋ/", meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "The early part of the day." }] }] }],
      }),
    );
    await expect(page.getByText("The early part of the day.")).toBeVisible();
    await inspect();
  }],
  ["word panel with the dictionary unreachable", async (page, inspect) => {
    await selectDictionaryWord(page, (route) => route.abort());
    await expect(page.getByText("Couldn't reach the dictionary. Check your connection.")).toBeVisible();
    await inspect();
  }],
  ["word saved", async (page, inspect) => {
    await selectWord(page);
    await page.getByRole("button", { name: "Save word" }).click();
    await expect(page.getByRole("button", { name: "Saved, remove from review deck" })).toBeVisible();
    await inspect();
  }],
  ["Undo toast after removing a saved word", async (page, inspect) => {
    await selectWord(page);
    await page.getByRole("button", { name: "Save word" }).click();
    await page.getByRole("button", { name: "Saved, remove from review deck" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await inspect();
  }],
  ["lesson summary", async (page, inspect) => {
    await openLibraryLesson(page, LIBRARY_LESSON);
    await attemptEverySentence(page);
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next lesson: Shopping Basics" })).toBeVisible();
    await inspect();
  }],
  ["lesson summary when the completion save fails", async (page, inspect) => {
    await page.addInitScript(() => {
      indexedDB.open = () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      };
    });
    await openLibraryLesson(page, LIBRARY_LESSON);
    await attemptEverySentence(page);
    await expect(page.getByRole("region", { name: "Lesson complete" }).getByRole("alert")).toHaveText("Couldn't save your progress.");
    await expect(page.getByRole("button", { name: "Try again" }).last()).toBeVisible();
    await inspect();
  }],
  ["review when the deck fails to load", async (page, inspect) => {
    await page.addInitScript(() => {
      indexedDB.open = () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      };
    });
    await page.goto("/#/review");
    await expect(page.getByText("Your review deck couldn't be loaded.")).toBeVisible();
    await inspect();
  }],
  ["review at the daily new-card limit", async (page, inspect) => {
    await seedStore(page, "newCardLimit");
    await page.goto("/#/review");
    await expect(page.getByText("Daily limit of 20 new cards reached. 1 new card is waiting.")).toBeVisible();
    await inspect();
  }],
  ["review all caught up", async (page, inspect) => {
    await openReviewWithDueCard(page);
    await page.getByRole("button", { name: "Show answer" }).click();
    await page.getByRole("button", { name: "Good" }).click();
    await expect(page.getByText("0 due")).toBeVisible();
    await inspect();
  }],
  ["import form with a validation error", async (page, inspect) => {
    await showImportError(page);
    await inspect();
  }],
  ["video lesson", async (page, inspect) => {
    await openVideoLesson(page);
    await inspect();
  }],
  ["account disclosure collapsed", async (page, inspect) => {
    await showCollapsedAccount(page);
    await inspect();
  }],
  ["account form in Sign in mode", async (page, inspect) => {
    await openSignIn(page);
    await inspect();
  }],
  ["account form in Create account mode", async (page, inspect) => {
    await openCreateAccount(page);
    await inspect();
  }],
  ["account form with an inline field error", async (page, inspect) => {
    await showAccountFieldError(page);
    await inspect();
  }],
  ["account form during a 429 countdown", async (page, inspect) => {
    await showAccountCountdown(page);
    await inspect();
  }],
  ["signed in with the sync line", async (page, inspect) => {
    await showSyncLine(page);
    await inspect();
  }],
  ["account form with a taken email and Sign in instead?", async (page, inspect) => {
    await answerWithStatus(page, "/signup", 409);
    await page.goto("/");
    await submitAccount(page, "Create account", uniqueEmail(), ACCOUNT_PASSWORD);
    await expect(page.getByRole("button", { name: "Sign in instead?" })).toBeVisible();
    await inspect();
  }],
  ["account form after a wrong password", async (page, inspect) => {
    await page.goto("/");
    await submitAccount(page, "Sign in", uniqueEmail(), ACCOUNT_PASSWORD);
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    await inspect();
  }],
  ["account form when the server is unreachable", async (page, inspect) => {
    await page.route("**/login", (route) => route.abort());
    await page.goto("/");
    await submitAccount(page, "Sign in", uniqueEmail(), ACCOUNT_PASSWORD);
    await expect(page.getByText("Can't reach the server. You can keep practising on this device.")).toBeVisible();
    await inspect();
  }],
  ["session expired", async (page, inspect) => {
    await signUpWithSync(page, 401);
    await expect(page.getByText("You were signed out. Sign in again to sync.")).toBeVisible();
    await inspect();
  }],
  ["sync failed", async (page, inspect) => {
    await signUpWithSync(page, 500);
    await expect(page.getByText("Saved on this device. Will sync when you're back online.")).toBeVisible();
    await inspect();
  }],
];

test.describe("axe", () => {
  for (const [name, reach] of STATES) {
    test(name, async ({ page }) => {
      await reach(page, async () => {
        expect(await axeViolations(page)).toEqual([]);
      });
    });
  }
});

test("axe on the summary with missed words, before and after saving one", async ({ page }) => {
  await openLibraryLesson(page, LIBRARY_LESSON);
  await missOneWord(page);
  const missed = page.getByRole("list", { name: "Missed words" });
  await expect(missed.getByRole("button", { name: "Save “today” to review" })).toBeVisible();
  expect(await axeViolations(page), "before saving").toEqual([]);
  await missed.getByRole("button", { name: "Save “today” to review" }).click();
  await expect(missed.getByRole("button", { name: "Saved “today”, remove from review deck" })).toBeVisible();
  expect(await axeViolations(page), "after saving").toEqual([]);
});

test.describe("axe at 320px", () => {
  test.use({ viewport: { width: 320, height: 740 } });

  test("library, a lesson and review", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: LIBRARY_LESSON })).toBeVisible();
    expect(await axeViolations(page), "library").toEqual([]);
    await openReviewWithDueCard(page);
    expect(await axeViolations(page), "review").toEqual([]);
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: LIBRARY_LESSON }).click();
    await expect(page.getByRole("heading", { level: 1, name: LIBRARY_LESSON })).toBeVisible();
    expect(await axeViolations(page), "lesson").toEqual([]);
  });

  test("guided shadowing", async ({ page }) => {
    await openGuided(page);
    expect(await axeViolations(page)).toEqual([]);
  });
});

async function focusIndicator(page: Page): Promise<{ label: string; visible: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const style = getComputedStyle(el);
    const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
    return {
      label: `${el.tagName} ${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40)}`,
      visible: outline || style.boxShadow !== "none",
    };
  });
}

async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    return el === document.body || el === null
      ? "BODY"
      : `${el.tagName} ${el.getAttribute("aria-label") ?? el.textContent?.trim()}`;
  });
}

// Tabs until the target has focus, asserting every stop on the way shows a focus indicator.
async function tabTo(page: Page, target: ReturnType<Page["getByRole"]>, key = "Tab"): Promise<void> {
  const hidden: string[] = [];
  for (let step = 0; step < 80; step += 1) {
    await page.keyboard.press(key);
    const indicator = await focusIndicator(page);
    if (!indicator.visible) {
      hidden.push(indicator.label);
    }
    if (await target.evaluate((el) => el === document.activeElement)) {
      expect(hidden, "focused controls without a visible focus indicator").toEqual([]);
      return;
    }
  }
  throw new Error("target never received focus");
}

test.describe("keyboard", () => {
  test("open a lesson, listen, save a word, review and rate", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("button", { name: LIBRARY_LESSON });
    await expect(row).toBeVisible();

    await tabTo(page, row);
    await page.keyboard.press("Enter");
    const heading = page.getByRole("heading", { level: 1, name: LIBRARY_LESSON });
    await expect(heading).toBeFocused();
    expect((await focusIndicator(page)).visible).toBe(true);

    await tabTo(page, page.getByRole("button", { name: "morning", exact: true }));
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Hear word" })).toBeVisible();

    await tabTo(page, page.getByRole("button", { name: "Save word" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Saved" })).toHaveAccessibleName("Saved, remove from review deck");
    await expect(page.getByRole("button", { name: "Saved" })).toBeFocused();

    await tabTo(page, page.getByRole("button", { name: "Listen" }).first());
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken))
      .toContain("Good morning, how are you today?");

    const reviewToggle = page.getByRole("button", { name: "Review", exact: true });
    await tabTo(page, reviewToggle, "Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByText("1 due")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Review deck" })).toBeFocused();

    await tabTo(page, page.getByRole("button", { name: "Show answer" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Good" })).toBeVisible();
    expect(await focusedName(page)).toContain("Good morning, how are you today?");

    await tabTo(page, page.getByRole("button", { name: "Good" }));
    await page.keyboard.press("Enter");
    await expect(page.getByText("0 due")).toBeVisible();
    await expect.poll(() => focusedName(page)).toContain("All caught up");
  });

  test("the freezes tooltip opens from the keyboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "About Me" })).toBeVisible();
    await tabTo(page, page.getByText("Freezes 0 of 2"));
    await expect(page.getByRole("tooltip")).toHaveText(FREEZE_HELP);
  });

  test("the storage banner moves focus to Your data", async ({ page }) => {
    await showStorageBanner(page);
    await tabTo(page, page.getByRole("button", { name: "Back up" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: "Your data" })).toBeFocused();
  });

  test("Back returns focus to the lesson row that opened the lesson", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("button", { name: LIBRARY_LESSON });
    await tabTo(page, row);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: LIBRARY_LESSON })).toBeFocused();

    await tabTo(page, page.getByRole("button", { name: "Back to lessons" }), "Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(row).toBeFocused();
  });
});

// Every drawn text element of the row lies inside the row's box and nothing scrolls.
async function rowOverflow(page: Page, title: string): Promise<string[]> {
  return page.getByRole("button", { name: title, exact: true }).evaluate((button) => {
    const outer = button.getBoundingClientRect();
    return [button, ...button.querySelectorAll<HTMLElement>("*")].flatMap((el) => {
      const rect = el.getBoundingClientRect();
      const problems: string[] = [];
      if (el.scrollWidth > el.clientWidth) {
        problems.push(`${el.tagName} scrolls: ${el.scrollWidth} > ${el.clientWidth}`);
      }
      // Astryx's 1px visually hidden span is not drawn text.
      if (el.textContent && rect.height > 1 && (rect.top < outer.top || rect.bottom > outer.bottom || rect.right > outer.right)) {
        problems.push(`${el.tagName} outside the row: ${el.textContent.trim()}`);
      }
      return problems;
    });
  });
}

test("desktop lesson rows keep their meta line inside the row", async ({ page }) => {
  await createUserLesson(page);
  for (const title of [LIBRARY_LESSON, USER_LESSON]) {
    expect(await rowOverflow(page, title), `${title} row`).toEqual([]);
  }
});

async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth > width) {
      problems.push(`page scrolls horizontally: ${document.documentElement.scrollWidth} > ${width}`);
    }
    const controls = document.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, audio[controls], [tabindex="0"]');
    for (const el of controls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        continue;
      }
      const name = `${el.tagName} ${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)}`;
      if (rect.left < 0 || rect.right > width) {
        problems.push(`clipped: ${name} [${Math.round(rect.left)}, ${Math.round(rect.right)}]`);
      }
      // Words inside a sentence are inline targets, which WCAG 2.5.8 exempts.
      if (!el.closest("p") && (rect.width < 24 || rect.height < 24)) {
        problems.push(`target under 24px: ${name} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth) {
        problems.push(`truncated: ${el.textContent?.trim()}`);
      }
    }
    return problems;
  });
}

const MOBILE_STATES: [string, (page: Page) => Promise<void>][] = [
  ["library", createUserLesson],
  ["lesson in shadow mode with a word selected", selectWord],
  ["review", async (page) => {
    await openReviewWithDueCard(page);
    await page.getByRole("button", { name: "Show answer" }).click();
  }],
  ["import form", showImportError],
];

test.describe("mobile 375x667", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  for (const [name, reach] of MOBILE_STATES) {
    test(name, async ({ page }) => {
      await reach(page);
      expect(await layoutProblems(page)).toEqual([]);
    });
  }

  test("the header leaves the first lesson inside the first screen", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("button", { name: "About Me" });
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box?.y).toBeLessThan(667);
  });

  for (const granted of [true, false]) {
    test(`the first lesson stays inside the first screen when persistence is ${granted ? "granted" : "not granted"}`, async ({ page }) => {
      await grantPersistence(page, granted);
      await page.goto("/");
      await expect(page.getByText(STORAGE_BANNER)).toHaveCount(granted ? 0 : 1);
      const box = await page.getByRole("button", { name: "About Me" }).boundingBox();
      console.log(`first row y at 375x667, persistence ${granted ? "granted" : "not granted"}: ${box?.y}`);
      expect(box?.y).toBeLessThan(667);
    });
  }

  test("lesson rows keep their text unclipped and Delete at least 24x24", async ({ page }) => {
    await createUserLesson(page);
    for (const title of [LIBRARY_LESSON, USER_LESSON]) {
      expect(await rowOverflow(page, title), `${title} row`).toEqual([]);
    }
    const box = await page.getByRole("button", { name: `Delete ${USER_LESSON}` }).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(24);
    expect(box?.height).toBeGreaterThanOrEqual(24);
  });
});

const PRACTICE_STATES: [string, (page: Page) => Promise<void>][] = [
  ["dictation result with the hint", checkDictationWithHint],
  ["A1 blank with the word bank", openA1WordBank],
  ["shadow mode with one sentence's text hidden", hideFirstSentenceText],
];

for (const width of [320, 360]) {
  test.describe(`practice controls at ${width}px`, () => {
    test.use({ viewport: { width, height: 740 } });

    for (const [name, reach] of PRACTICE_STATES) {
      test(name, async ({ page }, testInfo) => {
        await reach(page);
        await page.screenshot({ path: testInfo.outputPath(`${width}.png`), fullPage: true });
        expect(await layoutProblems(page)).toEqual([]);
      });
    }
  });
}

const LIBRARY_STATES: [string, (page: Page) => Promise<void>][] = [
  ["top-streak-0", showLibraryTop],
  ["top-storage-kept", async (page) => {
    await grantPersistence(page, true);
    await showLibraryTop(page);
  }],
  ["top-streak", practiseOnce],
  ["tooltip", openFreezeTooltip],
  ["banner", showStorageBanner],
  ["your-data", showYourData],
];

for (const width of [320, 360]) {
  test.describe(`library at ${width}px`, () => {
    test.use({ viewport: { width, height: 740 } });

    for (const [name, reach] of LIBRARY_STATES) {
      test(name, async ({ page }, testInfo) => {
        await reach(page);
        await page.screenshot({ path: testInfo.outputPath(`library-${name}-${width}.png`) });
        expect(await layoutProblems(page)).toEqual([]);
      });
    }
  });
}

test.describe("streak text at 320px with 200% text", () => {
  test.use({ viewport: { width: 320, height: 740 } });

  for (const [streak, reach] of [["Start a new streak today", showLibraryTop], ["1-day streak", practiseOnce]] as const) {
    test(`"${streak}" stays inside the Today card`, async ({ page }) => {
      await reach(page);
      await page.addStyleTag({ content: "html { font-size: 200%; }" });
      const card = await todayCard(page).boundingBox();
      const text = await todayCard(page).getByText(streak).boundingBox();
      expect(text!.x + text!.width).toBeLessThanOrEqual(card!.x + card!.width);
      expect(card!.x + card!.width).toBeLessThanOrEqual(320);
    });
  }
});

const ACCOUNT_STATES: [string, (page: Page) => Promise<void>][] = [
  ["collapsed", showCollapsedAccount],
  ["sign-in", openSignIn],
  ["create-account", openCreateAccount],
  ["field-error", showAccountFieldError],
  ["countdown", showAccountCountdown],
  ["sync-line", showSyncLine],
];

for (const width of [320, 360]) {
  test.describe(`account area at ${width}px`, () => {
    test.use({ viewport: { width, height: 740 } });

    for (const [name, reach] of ACCOUNT_STATES) {
      test(name, async ({ page }, testInfo) => {
        await reach(page);
        await page.screenshot({ path: testInfo.outputPath(`account-${name}-${width}.png`), fullPage: true });
        expect(await layoutProblems(page)).toEqual([]);
      });
    }
  });
}

async function motion(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Deterministic: computed styles, not whatever happens to be running now. Astryx zeroes its
    // Button and ToggleButton motion itself but not Link's 125ms transition, and a Link only renders
    // in some states, so a probe with its own inline motion checks the global rule in every state.
    const found: string[] = [];
    const probe = document.createElement("a");
    probe.className = "astryx-link";
    probe.style.transition = "color 0.125s";
    probe.style.animation = "probe 1s infinite";
    document.body.append(probe);
    for (const [selector, required] of [
      [".astryx-button", true],
      [".astryx-toggle-button", true],
      [".astryx-link", true],
    ] as const) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      if (required && elements.length === 0) {
        found.push(`no ${selector} to inspect`);
      }
      for (const el of elements) {
        const style = getComputedStyle(el);
        const still =
          style.transitionProperty === "none" ||
          style.transitionDuration.split(",").every((value) => parseFloat(value) === 0);
        if (!still || style.animationName !== "none") {
          found.push(`${selector} transition ${style.transitionProperty} ${style.transitionDuration} animation ${style.animationName}`);
        }
      }
    }
    probe.remove();
    found.push(...document
      .getAnimations()
      .filter((animation) => animation.playState === "running")
      .map((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return `running animation ${(animation as CSSAnimation).animationName ?? ""} on ${target?.tagName}.${target?.className}`;
      }));
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      const durations = getComputedStyle(el).transitionDuration.split(",").map((value) => {
        const trimmed = value.trim();
        return trimmed.endsWith("ms") ? parseFloat(trimmed) / 1000 : parseFloat(trimmed);
      });
      if (durations.some((seconds) => seconds > 0.01)) {
        found.push(`transition ${getComputedStyle(el).transitionDuration} on ${el.tagName}.${el.className}`);
      }
    }
    return found;
  });
}

test.describe("reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  for (const [name, reach] of STATES) {
    test(name, async ({ page }) => {
      await reach(page, async () => {
        expect(await motion(page)).toEqual([]);
      });
    });
  }
});

test.describe("first-run welcome", () => {
  test.use({ welcomed: false });
  const welcome = (page: Page) => page.getByRole("region", { name: "Welcome to Road to English" });

  async function showStep1(page: Page): Promise<void> {
    await showStorageBanner(page);
    await expect(welcome(page).getByText("Step 1 of 2")).toBeVisible();
    await expect(page.getByRole("button", { name: "About Me" })).toBeVisible();
  }

  async function showStep2(page: Page): Promise<void> {
    await showStep1(page);
    await welcome(page).getByRole("button", { name: "Next" }).click();
    await expect(welcome(page).getByText("Step 2 of 2")).toBeVisible();
  }

  async function finish(page: Page): Promise<void> {
    await showStep2(page);
    await welcome(page).getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("heading", { name: "Today" })).toBeFocused();
  }

  for (const [name, reach] of [["step 1", showStep1], ["step 2", showStep2]] as const) {
    test(`axe on ${name}`, async ({ page }) => {
      await reach(page);
      expect(await axeViolations(page)).toEqual([]);
    });

    test(`the first lesson stays inside the first screen on ${name} with the storage banner`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await reach(page);
      const box = await page.getByRole("button", { name: "About Me" }).boundingBox();
      console.log(`first row y at 375x667, welcome ${name}, storage banner: ${box?.y}`);
      expect(box?.y).toBeLessThan(667);
    });
  }

  test.describe("reduced motion", () => {
    test.use({ contextOptions: { reducedMotion: "reduce" } });

    for (const [name, reach] of [["step 1", showStep1], ["step 2", showStep2]] as const) {
      test(name, async ({ page }) => {
        await reach(page);
        expect(await motion(page)).toEqual([]);
      });
    }
  });

  for (const width of [320, 360]) {
    test.describe(`at ${width}px`, () => {
      test.use({ viewport: { width, height: 740 } });

      for (const [name, reach] of [["welcome-step-1", showStep1], ["welcome-step-2", showStep2], ["welcome-done", finish]] as const) {
        test(name, async ({ page }, testInfo) => {
          await reach(page);
          await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`) });
          expect(await layoutProblems(page)).toEqual([]);
        });
      }
    });
  }
});
