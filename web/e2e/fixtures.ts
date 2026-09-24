import { readFile } from "node:fs/promises";

import { test as base, expect, type Download, type Page } from "@playwright/test";

const YT_API = "https://www.youtube.com/iframe_api";

// Stands in for the YouTube IFrame API: records every Player call on window.__yt.
const FAKE_YT_API = `
(() => {
  const yt = (window.__yt = { created: [], calls: [] });
  class Player {
    constructor(element, options) {
      this.time = 0;
      yt.created.push({ videoId: options.videoId, host: options.host });
      // Like the real API: the element becomes an iframe sized by the width/height options.
      const frame = document.createElement("iframe");
      frame.title = "YouTube video player";
      frame.width = options.width;
      frame.height = options.height;
      element.replaceWith(frame);
      setTimeout(() => options.events.onReady(), 0);
    }
    playVideo() { yt.calls.push(["playVideo"]); }
    pauseVideo() { yt.calls.push(["pauseVideo"]); }
    seekTo(seconds, allowSeekAhead) { this.time = seconds; yt.calls.push(["seekTo", seconds, allowSeekAhead]); }
    setPlaybackRate(rate) { yt.calls.push(["setPlaybackRate", rate]); }
    getCurrentTime() { return this.time; }
    destroy() { yt.calls.push(["destroy"]); }
  }
  window.YT = { Player };
  window.onYouTubeIframeAPIReady?.();
})();
`;

// Runs before app code on every document: a scripted SpeechRecognition and a speechSynthesis.speak
// that records the text and fires end asynchronously (headless Chromium has no voices).
function installBrowserFakes() {
  const w = window as unknown as Record<string, unknown>;
  w.__spoken = [] as string[];
  w.__speechTranscript = "";

  class FakeRecognition {
    lang = "";
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    processLocally = false;
    onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      setTimeout(() => {
        this.onresult?.({ results: [[{ transcript: String(w.__speechTranscript) }]] });
        this.onend?.();
      }, 50);
    }
    abort() {
      setTimeout(() => this.onend?.(), 0);
    }
  }
  w.SpeechRecognition = FakeRecognition;
  w.webkitSpeechRecognition = FakeRecognition;

  speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
    (w.__spoken as string[]).push(utterance.text);
    setTimeout(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent), 0);
  };
  speechSynthesis.cancel = () => undefined;
}

// Every test starts past the first-run welcome unless it opts in with test.use({ welcomed: false }).
export const test = base.extend<{ external: string[]; welcomed: boolean }>({
  welcomed: [true, { option: true }],
  external: async ({ context }, use) => {
    const external: string[] = [];
    await context.route("**/*", (route) => {
      const url = route.request().url();
      const { hostname } = new URL(url);
      if (hostname === "localhost" || hostname === "127.0.0.1") {
        return route.continue();
      }
      if (url === YT_API) {
        return route.fulfill({ contentType: "text/javascript", body: FAKE_YT_API });
      }
      external.push(url);
      return route.abort();
    });
    await context.addInitScript(installBrowserFakes);
    await use(external);
    expect(external, "external requests").toEqual([]);
  },
  page: async ({ page, external, welcomed }, use) => {
    void external;
    if (welcomed) {
      await page.addInitScript(() => localStorage.setItem("road-to-english.welcomed", "done"));
    }
    await use(page);
  },
});

export { expect };

export async function downloadText(download: Download): Promise<string> {
  return readFile(await download.path(), "utf8");
}

export async function openLibraryLesson(page: Page, title: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: title }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

// Answers every sentence's dictation, one form at a time by its input id.
export async function attemptEverySentence(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Dictation" }).click();
  const ids = await page.getByLabel("What did you hear?").evaluateAll((inputs) => inputs.map((input) => input.id));
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    const form = page.locator("form", { has: page.locator(`[id="${id}"]`) });
    await form.getByLabel("What did you hear?").fill("something");
    await form.getByRole("button", { name: "Check" }).click();
  }
}

// Answers every sentence's dictation with its text, read in Shadow mode, but leaves "today" out of the
// first, so the summary lists one missed word.
export async function missOneWord(page: Page): Promise<void> {
  const texts = await page.locator("ol > li").evaluateAll((items) => items.map((item) => item.querySelector("p")?.textContent ?? ""));
  expect(texts[0]).toBe("Good morning, how are you today?");
  await page.getByRole("button", { name: "Dictation" }).click();
  const ids = await page.getByLabel("What did you hear?").evaluateAll((inputs) => inputs.map((input) => input.id));
  expect(ids).toHaveLength(texts.length);
  for (const [index, id] of ids.entries()) {
    const form = page.locator("form", { has: page.locator(`[id="${id}"]`) });
    await form.getByLabel("What did you hear?").fill(index === 0 ? "Good morning, how are you" : texts[index]);
    await form.getByRole("button", { name: "Check" }).click();
  }
}

export const TRANSCRIPT = "0:00\nHello there, my friend.\n0:07\nThis is the second line.";

// Fills the library's create form and submits it; callers assert what the new lesson shows.
export async function createLesson(
  page: Page,
  { title, text, videoUrl }: { title: string; text: string; videoUrl?: string },
): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Title").fill(title);
  if (videoUrl) {
    await page.getByLabel("YouTube URL").fill(videoUrl);
  }
  await page.getByLabel("Text", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Create", exact: true }).click();
}

export const ACCOUNT_PASSWORD = "correct horse battery";

// A fresh address per call, so reruns against the same database never collide.
export function uniqueEmail(): string {
  return `learner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export const accountDisclosure = (page: Page) => page.getByRole("button", { name: "Account", exact: true });

// Expands the signed-out account form if it is collapsed.
export async function openAccountForm(page: Page): Promise<void> {
  const disclosure = accountDisclosure(page);
  if ((await disclosure.getAttribute("aria-expanded")) !== "true") {
    await disclosure.click();
  }
  await expect(page.getByLabel("Email")).toBeFocused();
}

export const accountModes = (page: Page) => page.getByRole("radiogroup", { name: "Sign in or create an account" });
export const accountSubmit = (page: Page) => page.locator('form:has(input[type="email"]) button[type="submit"]');

// Fills and submits the account form in the given mode.
export async function submitAccount(page: Page, mode: "Sign in" | "Create account", email: string, password: string): Promise<void> {
  await openAccountForm(page);
  await accountModes(page).getByRole("radio", { name: mode }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await accountSubmit(page).click();
}

// The real /login answers, then its status becomes 429 with this Retry-After; the api's own CORS headers stay.
export async function limitLogin(page: Page, retryAfter: string): Promise<void> {
  await page.route("**/login", async (route) => {
    if (route.request().method() !== "POST") {
      return route.continue();
    }
    const response = await route.fetch();
    return route.fulfill({ response, status: 429, headers: { ...response.headers(), "retry-after": retryAfter } });
  });
}
