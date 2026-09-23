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

export const test = base.extend<{ external: string[] }>({
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
  page: async ({ page, external }, use) => {
    void external;
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
