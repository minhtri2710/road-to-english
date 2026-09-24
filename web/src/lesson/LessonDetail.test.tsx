import { afterEach, describe, expect, it, vi } from "vitest";

import { getPracticeDays } from "../lib/progressStore";
import { getAllCards } from "../lib/vocabStore";
import { listUserLessons } from "../lib/userLessons";
import {
  actionsToday,
  blockStorage,
  buttonsNamed,
  click,
  clickButtonWith,
  clickElement,
  close,
  fetchMock,
  h1Texts,
  harnessAct,
  harnessActSync,
  hasText,
  openLesson,
  renderApp,
  resetApp,
  setInputValue,
  submitInput,
  waitForActions,
  waitForCondition,
} from "../test/app";
import {
  installMediaDevices,
  installObjectUrlFakes,
  installSpeechFakes,
} from "../test/browser";
import { greetingsLesson } from "../test/fixtures";

describe("LessonDetail", () => {
  afterEach(resetApp);

  it("records dictation practice and shows the streak witness", async () => {
    vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    const { container } = await openLesson();

    await clickButtonWith(container, "Dictation");

    const input = container.querySelector<HTMLInputElement>(
      `#dictation-${greetingsLesson.sentences[0].id}`,
    );
    if (!input) throw new Error("dictation input not found");
    await submitInput(input, greetingsLesson.sentences[0].text);
    await waitForActions(1);

    expect(await getPracticeDays()).toHaveLength(1);
    await click(container, "Back to lessons");
    await waitForCondition(hasText(container, "1-day streak"));
  });

  it("drills fill-the-blank: hides the word, checks, records, resets, and plays", async () => {
    const speak = vi.fn();
    class FakeUtterance {
      lang = "";
      rate = 1;
      constructor(readonly text: string) {}
    }
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const { container } = await openLesson();
    const [first, second] = greetingsLesson.sentences;

    await clickButtonWith(container, "Fill the blank");
    // The gap is aria-hidden; a visually hidden "blank" is read in its place.
    expect(container.textContent).toContain("Good ____blank, how are you today?");
    expect(container.textContent).not.toContain("morning");
    expect(container.querySelector(`label[for="blank-${first.id}"]`)).not.toBeNull();
    expect(await actionsToday()).toBe(0);

    await clickButtonWith(container, "Play");
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: first.text }));

    const input = container.querySelector<HTMLInputElement>(`#blank-${first.id}`);
    if (!input) throw new Error("blank input not found");
    await submitInput(input, " MORNING! ");
    expect(container.textContent).toContain("Correct");
    await waitForActions(1);

    await clickButtonWith(container, "Try again");
    expect(input.value).toBe("");
    expect(container.textContent).not.toContain("Correct");

    const secondInput = container.querySelector<HTMLInputElement>(`#blank-${second.id}`);
    if (!secondInput) throw new Error("second blank input not found");
    await submitInput(secondInput, "meet");
    expect(container.textContent).toContain("Not quite — the word was nice");
    await waitForActions(2);
  });

  it("stops reference speech on a lesson mode change", async () => {
    const speech = installSpeechFakes();
    const view = await openLesson();
    await click(view.container, "Listen");
    expect(speech.spoken).toHaveLength(1);
    speech.cancel.mockClear();
    await click(view.container, "Dictation");
    expect(speech.cancel).toHaveBeenCalled();
  });

  it("hides and restores the shadowing transcript", async () => {
    installSpeechFakes();
    const { container } = await openLesson();

    const transcript = buttonsNamed(container, "Transcript")[0]!;
    expect(transcript.getAttribute("aria-pressed")).toBe("true");
    await harnessAct(async () => {
      transcript.click();
    });
    expect(buttonsNamed(container, "Transcript")[0]).toBe(transcript);
    expect(transcript.getAttribute("aria-pressed")).toBe("false");
    for (const sentence of greetingsLesson.sentences) {
      expect(container.textContent).not.toContain(sentence.text);
    }
    expect(container.textContent).not.toContain("casual sign-off");

    await harnessAct(async () => {
      transcript.click();
    });
    expect(transcript.getAttribute("aria-pressed")).toBe("true");
    for (const sentence of greetingsLesson.sentences) {
      expect(container.textContent).toContain(sentence.text);
    }
    expect(container.textContent).toContain("casual sign-off");
  });

  it("toggles Vietnamese independently of the transcript", async () => {
    installSpeechFakes();
    const { container } = await openLesson();

    for (const sentence of greetingsLesson.sentences) {
      expect(container.textContent).not.toContain(sentence.vi);
    }
    const vietnamese = buttonsNamed(container, "Vietnamese")[0]!;
    expect(vietnamese.getAttribute("aria-pressed")).toBe("false");

    await harnessAct(async () => {
      vietnamese.click();
    });
    expect(vietnamese.getAttribute("aria-pressed")).toBe("true");
    for (const sentence of greetingsLesson.sentences) {
      expect(container.textContent).toContain(sentence.vi);
    }

    await click(container, "Transcript");
    for (const sentence of greetingsLesson.sentences) {
      expect(container.textContent).not.toContain(sentence.text);
      expect(container.textContent).toContain(sentence.vi);
    }

    await harnessAct(async () => {
      vietnamese.click();
    });
    expect(vietnamese.getAttribute("aria-pressed")).toBe("false");
    for (const sentence of greetingsLesson.sentences) {
      expect(container.textContent).not.toContain(sentence.vi);
    }

    await click(container, "Transcript");
    for (const sentence of greetingsLesson.sentences) {
      expect(container.textContent).toContain(sentence.text);
      expect(container.textContent).not.toContain(sentence.vi);
    }
  });

  it("moves focus through the pronunciation disclosure", async () => {
    vi.stubGlobal("webkitSpeechRecognition", class {});
    const view = await openLesson();
    const { container } = view;
    await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");

    const toggle = buttonsNamed(container, "Pronunciation check")[0]!;
    toggle.focus();
    await click(container, "Pronunciation check");
    expect(document.activeElement).toBe(buttonsNamed(container, "Enable")[0]);
    await click(container, "Cancel");
    expect(document.activeElement).toBe(buttonsNamed(container, "Pronunciation check")[0]);
  });

  describe("video lessons", () => {
    const transcript = "0:00\nI like green tea.\n0:02\nDo you like it?\n1:05\nWe drink it\nevery morning.";
    const iframeApi = "https://www.youtube.com/iframe_api";

    type PlayerOptions = {
      videoId: string;
      host: string;
      width: string;
      height: string;
      playerVars: object;
      events: { onReady: () => void; onError: () => void; onStateChange: (event: { data: number }) => void };
    };
    class FakePlayer {
      static instances: FakePlayer[] = [];
      calls: unknown[][] = [];
      time = 0;
      constructor(
        readonly element: HTMLElement,
        readonly options: PlayerOptions,
      ) {
        FakePlayer.instances.push(this);
      }
      playVideo() {
        this.calls.push(["playVideo"]);
      }
      pauseVideo() {
        this.calls.push(["pauseVideo"]);
      }
      seekTo(seconds: number, allowSeekAhead: boolean) {
        this.calls.push(["seekTo", seconds, allowSeekAhead]);
      }
      setPlaybackRate(rate: number) {
        this.calls.push(["setPlaybackRate", rate]);
      }
      getCurrentTime() {
        return this.time;
      }
      destroy() {
        this.calls.push(["destroy"]);
      }
    }

    function installYouTube() {
      FakePlayer.instances = [];
      window.YT = { Player: FakePlayer };
    }

    afterEach(() => {
      vi.useRealTimers();
      delete window.YT;
      delete window.onYouTubeIframeAPIReady;
      document.querySelectorAll(`script[src="${iframeApi}"]`).forEach((script) => script.remove());
    });

    async function renderLibrary() {
      const view = await renderApp();
      await waitForCondition(hasText(view.container, "Your lessons"));
      return view;
    }

    async function createLesson(container: HTMLElement, videoUrl: string, text: string) {
      const titleInput = container.querySelector<HTMLInputElement>("#import-title");
      const videoInput = container.querySelector<HTMLInputElement>("#import-video");
      const textArea = container.querySelector<HTMLTextAreaElement>("#import-text");
      if (!titleInput || !videoInput || !textArea) throw new Error("import form not found");
      expect(container.querySelector('label[for="import-video"]')?.textContent).toBe("YouTube URL");
      await harnessAct(async () => {
        setInputValue(titleInput, "Tea video");
        setInputValue(videoInput, videoUrl);
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textArea, text);
        textArea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await harnessAct(async () => {
        titleInput.form!.requestSubmit();
      });
    }

    async function openVideoLesson() {
      installYouTube();
      const view = await renderLibrary();
      await createLesson(view.container, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5s", transcript);
      await waitForCondition(() => view.container.textContent?.includes("Back to lessons") ?? false);
      await waitForCondition(() => FakePlayer.instances.length === 1);
      const player = FakePlayer.instances[0]!;
      await harnessAct(async () => {
        player.options.events.onReady();
      });
      return { view, player };
    }

    it("creates a video lesson from a URL and a transcript and opens it in a nocookie player", async () => {
      installYouTube();
      const view = await renderLibrary();
      expect(view.container.textContent).toContain(
        "Paste the transcript from YouTube's Show transcript panel (timestamps included).",
      );
      await createLesson(view.container, "https://youtu.be/dQw4w9WgXcQ", transcript);
      await waitForCondition(() => view.container.textContent?.includes("Back to lessons") ?? false);
      await waitForCondition(() => FakePlayer.instances.length === 1);

      const [player] = FakePlayer.instances;
      expect(player?.options).toMatchObject({
        videoId: "dQw4w9WgXcQ",
        host: "https://www.youtube-nocookie.com",
        playerVars: { playsinline: 1, rel: 0 },
      });
      expect(view.container.contains(player?.element ?? null)).toBe(true);
      const back = buttonsNamed(view.container, "Back to lessons")[0]!;
      const heading = Array.from(view.container.querySelectorAll("h1")).find((node) => node.textContent === "Tea video")!;
      for (const header of [back, heading]) {
        expect(header.compareDocumentPosition(player!.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      expect(view.container.textContent).toContain("Video from YouTube; playing it connects to YouTube.");
      expect(view.container.textContent).toContain("We drink it every morning.");
      expect(buttonsNamed(view.container, "Play clip")).toHaveLength(3);
      expect(buttonsNamed(view.container, "Play clip").every((button) => button.disabled)).toBe(true);

      await harnessAct(async () => {
        player?.options.events.onReady();
      });
      expect(buttonsNamed(view.container, "Play clip").some((button) => button.disabled)).toBe(false);
      expect(document.querySelector(`script[src="${iframeApi}"]`)).toBeNull();
      const [stored] = await listUserLessons();
      expect(stored).toMatchObject({
        videoId: "dQw4w9WgXcQ",
        sentences: [
          { text: "I like green tea.", cue: { start: 0, end: 2 } },
          { text: "Do you like it?", cue: { start: 2, end: 65 } },
          { text: "We drink it every morning.", cue: { start: 65, end: null } },
        ],
      });
    });

    it.each([
      ["a bad URL", "https://vimeo.com/1", transcript, "Enter a YouTube video URL."],
      ["leading text", "https://youtu.be/dQw4w9WgXcQ", `Hi\n${transcript}`, "The transcript must start with a timestamp."],
      ["non-increasing timestamps", "https://youtu.be/dQw4w9WgXcQ", "0:05\nOne.\n0:05\nTwo.", "Timestamps must increase"],
    ])("shows an inline error and stores nothing for %s", async (_name, videoUrl, text, message) => {
      installYouTube();
      const view = await renderLibrary();
      await createLesson(view.container, videoUrl, text);

      expect(view.container.textContent).toContain(message);
      expect(view.container.textContent).not.toContain("Back to lessons");
      expect(await listUserLessons()).toEqual([]);
      expect(FakePlayer.instances).toEqual([]);
      await close(view);
    });

    it("plays a clip at the chosen speed and pauses when the time passes the cue end", async () => {
      const { view, player } = await openVideoLesson();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      await click(view.container, "0.75x");
      await click(view.container, "Play clip", 1);
      expect(player.calls).toEqual([["setPlaybackRate", 0.75], ["seekTo", 2, true], ["playVideo"]]);

      player.time = 64.9;
      vi.advanceTimersByTime(100);
      expect(player.calls).not.toContainEqual(["pauseVideo"]);
      player.time = 65;
      vi.advanceTimersByTime(100);
      expect(player.calls.filter(([name]) => name === "pauseVideo")).toHaveLength(1);
      vi.advanceTimersByTime(1000);
      expect(player.calls.filter(([name]) => name === "pauseVideo")).toHaveLength(1);

      player.calls = [];
      await click(view.container, "Play clip", 2);
      expect(player.calls).toEqual([["setPlaybackRate", 0.75], ["seekTo", 65, true], ["playVideo"]]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("cancels the older clip's poll when a newer clip starts", async () => {
      const { view, player } = await openVideoLesson();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      await click(view.container, "Play clip");
      await click(view.container, "Play clip", 1);
      expect(vi.getTimerCount()).toBe(1);

      player.time = 3;
      vi.advanceTimersByTime(500);
      expect(player.calls).not.toContainEqual(["pauseVideo"]);
    });

    it("destroys the player and cancels the poll on unmount", async () => {
      const { view, player } = await openVideoLesson();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      await click(view.container, "Play clip");
      await click(view.container, "Back to lessons");

      expect(player.calls.filter(([name]) => name === "destroy")).toHaveLength(1);
      expect(view.container.contains(player.element)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      player.time = 100;
      vi.advanceTimersByTime(500);
      expect(player.calls).not.toContainEqual(["pauseVideo"]);
    });

    it("offers Play clip in the dictation and fill-the-blank modes", async () => {
      const { view, player } = await openVideoLesson();
      for (const mode of ["Dictation", "Fill the blank"]) {
        await click(view.container, mode);
        expect(buttonsNamed(view.container, "Play clip")).toHaveLength(3);
        player.calls = [];
        await click(view.container, "Play clip");
        expect(player.calls).toEqual([["setPlaybackRate", 1], ["seekTo", 0, true], ["playVideo"]]);
      }
      expect(FakePlayer.instances).toHaveLength(1);
    });

    it("creates no player and injects no script for a plain lesson", async () => {
      const view = await renderLibrary();
      const titleInput = view.container.querySelector<HTMLInputElement>("#import-title");
      const textArea = view.container.querySelector<HTMLTextAreaElement>("#import-text");
      if (!titleInput || !textArea) throw new Error("import form not found");
      await harnessAct(async () => {
        setInputValue(titleInput, "Tea talk");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textArea, "I like tea.");
        textArea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await harnessAct(async () => {
        titleInput.form!.requestSubmit();
      });
      await waitForCondition(() => view.container.textContent?.includes("Back to lessons") ?? false);

      expect(document.querySelector(`script[src="${iframeApi}"]`)).toBeNull();
      expect(window.onYouTubeIframeAPIReady).toBeUndefined();
      expect(buttonsNamed(view.container, "Play clip")).toEqual([]);
      expect(view.container.textContent).not.toContain("Video from YouTube");
    });

    class ClipRecognition {
      static instances: ClipRecognition[] = [];
      lang = "";
      continuous = true;
      interimResults = true;
      maxAlternatives = 5;
      onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      abort = vi.fn();
      constructor() {
        ClipRecognition.instances.push(this);
      }
    }

    async function openVideoLessonWithCheck() {
      localStorage.setItem("road-to-english.pronunciationCheck", "on");
      ClipRecognition.instances = [];
      vi.stubGlobal("webkitSpeechRecognition", ClipRecognition);
      const opened = await openVideoLesson();
      localStorage.removeItem("road-to-english.pronunciationCheck");
      return opened;
    }

    it("pauses the playing clip and clears its poll when a pronunciation check starts", async () => {
      const { view, player } = await openVideoLessonWithCheck();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      await click(view.container, "Play clip");
      expect(player.calls).toContainEqual(["playVideo"]);
      player.calls = [];
      await click(view.container, "Check pronunciation");
      expect(player.calls).toEqual([["pauseVideo"]]);
      expect(ClipRecognition.instances).toHaveLength(1);
      player.time = 10;
      vi.advanceTimersByTime(1000);
      expect(player.calls).toEqual([["pauseVideo"]]);
    });

    it("aborts a listening check silently when Play clip starts", async () => {
      const { view, player } = await openVideoLessonWithCheck();
      await click(view.container, "Check pronunciation");
      const recognition = ClipRecognition.instances.at(-1)!;
      expect(buttonsNamed(view.container, "Listening…")).toHaveLength(1);
      player.calls = [];
      await click(view.container, "Play clip");
      expect(recognition.abort).toHaveBeenCalledOnce();
      expect(buttonsNamed(view.container, "Listening…")).toHaveLength(0);
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(3);
      expect(buttonsNamed(view.container, "Try again")).toHaveLength(0);
      expect(view.container.textContent).not.toContain("aborted");
      expect(player.calls).toEqual([["setPlaybackRate", 1], ["seekTo", 0, true], ["playVideo"]]);
    });

    // The stub fires the script's error event instead of letting happy-dom try the network, the same path as a blocked or offline load.
    it("loads the API script once and shows the couldn't-load line when it fails, keeping the lesson usable", async () => {
      const append = vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
        for (const node of nodes) {
          setTimeout(() => (node as HTMLScriptElement).dispatchEvent(new Event("error")), 0);
        }
      });
      const view = await renderLibrary();
      await createLesson(view.container, "https://youtu.be/dQw4w9WgXcQ", transcript);
      await waitForCondition(() => view.container.textContent?.includes("Back to lessons") ?? false);

      await waitForCondition(
        () => view.container.textContent?.includes("The video couldn't load. You can keep practising with Listen.") ?? false,
      );
      expect(view.container.textContent).not.toContain("Loading video…");
      expect(append.mock.calls.map(([node]) => (node as HTMLScriptElement).src)).toEqual([iframeApi]);
      expect(document.querySelector(`script[src="${iframeApi}"]`)).toBeNull();
      expect(buttonsNamed(view.container, "Play clip").every((button) => button.disabled)).toBe(true);
      await click(view.container, "Dictation");
      expect(view.container.querySelector("#dictation-s1")).not.toBeNull();
    });

    it("sizes the player to fill a 16:9 column and shows Loading video… until ready", async () => {
      installYouTube();
      const view = await renderLibrary();
      await createLesson(view.container, "https://youtu.be/dQw4w9WgXcQ", transcript);
      await waitForCondition(() => FakePlayer.instances.length === 1);
      const player = FakePlayer.instances[0]!;
      expect(player.options).toMatchObject({ width: "100%", height: "100%" });
      expect(view.container.textContent).toContain("Loading video…");
      await harnessAct(async () => {
        player.options.events.onReady();
      });
      expect(view.container.textContent).not.toContain("Loading video…");
    });

    it("shows the couldn't-load line when the player is not ready after 15 s, keeps the lesson usable, and accepts a late ready", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
      installYouTube();
      installSpeechFakes();
      const view = await renderLibrary();
      await createLesson(view.container, "https://youtu.be/dQw4w9WgXcQ", transcript);
      await waitForCondition(() => FakePlayer.instances.length === 1);
      const player = FakePlayer.instances[0]!;
      const failed = "The video couldn't load. You can keep practising with Listen.";

      await harnessAct(async () => {
        vi.advanceTimersByTime(14_000);
      });
      expect(view.container.textContent).toContain("Loading video…");
      expect(view.container.textContent).not.toContain(failed);
      await harnessAct(async () => {
        vi.advanceTimersByTime(1_100);
      });
      expect(view.container.textContent).toContain(failed);
      expect(view.container.textContent).not.toContain("Loading video…");
      expect(buttonsNamed(view.container, "Listen")[0]?.disabled).toBe(false);

      await harnessAct(async () => {
        player.options.events.onReady();
      });
      expect(view.container.textContent).not.toContain(failed);
      expect(buttonsNamed(view.container, "Play clip").every((button) => !button.disabled)).toBe(true);
    });

    it("stops speech and the loop when the video starts playing, and Listen pauses the video", async () => {
      const speech = installSpeechFakes();
      const { view, player } = await openVideoLesson();
      await click(view.container, "Loop");
      expect(player.calls).toContainEqual(["pauseVideo"]);
      await harnessAct(async () => {
        speech.spoken.at(-1)?.onboundary?.({ name: "word", charIndex: 0 });
      });
      expect(view.container.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
      speech.cancel.mockClear();

      // The player's own controls start playback: YT.PlayerState.PLAYING.
      await harnessAct(async () => {
        player.options.events.onStateChange({ data: 1 });
      });
      expect(speech.cancel).toHaveBeenCalled();
      expect(buttonsNamed(view.container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
      expect(view.container.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
      const spoken = speech.spoken.length;
      await harnessAct(async () => {
        speech.finish();
      });
      expect(speech.spoken).toHaveLength(spoken);

      player.calls = [];
      await click(view.container, "Listen", 1);
      expect(player.calls).toEqual([["pauseVideo"]]);
    });
  });

  describe("pronunciation check", () => {
    class FakeRecognition {
      static instances: FakeRecognition[] = [];
      lang = "";
      continuous = true;
      interimResults = true;
      maxAlternatives = 5;
      processLocally = false;
      onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      abort = vi.fn();
      constructor() {
        FakeRecognition.instances.push(this);
      }
    }

    async function openShadow() {
      installSpeechFakes();
      FakeRecognition.instances = [];
      vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
      return openLesson();
    }

    async function enable(container: HTMLElement) {
      await click(container, "Pronunciation check");
      await click(container, "Enable");
    }

    async function checkFirstSentence(container: HTMLElement) {
      await click(container, "Check pronunciation");
      const recognition = FakeRecognition.instances.at(-1);
      if (!recognition) throw new Error("recognition not started");
      return recognition;
    }

    afterEach(() => {
      localStorage.clear();
    });

    it("is off by default with no Check buttons", async () => {
      const view = await openShadow();
      expect(buttonsNamed(view.container, "Pronunciation check")).toHaveLength(1);
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(0);
      expect(localStorage.getItem("road-to-english.pronunciationCheck")).toBeNull();
    });

    it("shows the disclosure first, keeps it off on Cancel, and persists Enable", async () => {
      const view = await openShadow();
      await click(view.container, "Pronunciation check");
      expect(view.container.textContent).toContain("speech recognition");
      expect(view.container.textContent).toContain("sent to Google's servers");
      expect(view.container.textContent).toContain("Nothing is sent to road-to-english.");
      expect(localStorage.getItem("road-to-english.pronunciationCheck")).toBeNull();
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(0);

      await click(view.container, "Cancel");
      expect(view.container.textContent).not.toContain("Nothing is sent to road-to-english.");
      expect(localStorage.getItem("road-to-english.pronunciationCheck")).toBeNull();
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(0);

      await enable(view.container);
      expect(localStorage.getItem("road-to-english.pronunciationCheck")).toBe("on");
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(3);
      await close(view);

      // The URL still routes to the lesson, so the remount opens it directly.
      const remounted = await renderApp();
      expect(buttonsNamed(remounted.container, "Check pronunciation")).toHaveLength(3);
    });

    it("shows the word count, the diff, and counts one practice", async () => {
      const view = await openShadow();
      expect(await actionsToday()).toBe(0);
      await enable(view.container);
      await click(view.container, "Loop");
      expect(buttonsNamed(view.container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("true");
      const recognition = await checkFirstSentence(view.container);
      expect(buttonsNamed(view.container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
      expect(recognition.processLocally).toBe(true);
      expect(buttonsNamed(view.container, "Listening…")[0]?.getAttribute("aria-disabled")).toBe("true");

      await harnessAct(async () => {
        recognition.onresult?.({ results: [[{ transcript: "good morning how are you today" }]] });
        recognition.onend?.();
      });
      const lines = Array.from(view.container.querySelectorAll('[role="status"] p')).map((p) => p.textContent);
      expect(lines.slice(0, 2)).toEqual([
        "What the browser heard: good morning how are you today",
        "The browser matched 6 of 6 words",
      ]);
      expect(view.container.textContent).not.toContain("Correct");
      await waitForActions(1);
      await harnessAct(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(await actionsToday()).toBe(1);

      await click(view.container, "Try again");
      expect(view.container.textContent).not.toContain("Reference:");
    });

    it("labels a wrong word with what was said", async () => {
      const view = await openShadow();
      await enable(view.container);
      const recognition = await checkFirstSentence(view.container);
      await harnessAct(async () => {
        recognition.onresult?.({ results: [[{ transcript: "good morning how are you tomorrow" }]] });
      });
      expect(view.container.textContent).toContain('today (you said "tomorrow")');
      expect(view.container.textContent).toContain("What the browser heard: good morning how are you tomorrow");
      expect(view.container.textContent).toContain("The browser matched 5 of 6 words");
      expect(view.container.textContent).not.toContain("Not quite");
    });

    it("shows a recognition error", async () => {
      const view = await openShadow();
      await enable(view.container);
      const recognition = await checkFirstSentence(view.container);
      await harnessAct(async () => {
        recognition.onerror?.({ error: "language-not-supported" });
        recognition.onend?.();
      });
      expect(view.container.textContent).toContain(
        "On-device English recognition isn't available in this browser. Use Record and Compare to check yourself.",
      );
      expect(FakeRecognition.instances).toHaveLength(1);
      await click(view.container, "Try again");
      expect(view.container.textContent).not.toContain("On-device English recognition");
    });

    it("disables the toggle with a reason when recognition is unsupported", async () => {
      localStorage.setItem("road-to-english.pronunciationCheck", "on");
      installSpeechFakes();
      const view = await openLesson();
      expect(buttonsNamed(view.container, "Pronunciation check")[0]?.disabled).toBe(true);
      expect(view.container.textContent).toContain(
        "Pronunciation check disabled: speech recognition is not supported in this browser.",
      );
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(0);
    });

    it("hides the Check buttons and aborts listening when turned off", async () => {
      const view = await openShadow();
      await enable(view.container);
      const recognition = await checkFirstSentence(view.container);
      await click(view.container, "Pronunciation check");
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(0);
      expect(buttonsNamed(view.container, "Listening…")).toHaveLength(0);
      expect(recognition.abort).toHaveBeenCalled();
      expect(localStorage.getItem("road-to-english.pronunciationCheck")).toBeNull();
    });

    it("resets the first sentence without a message when another sentence starts a check", async () => {
      const view = await openShadow();
      await enable(view.container);
      const first = await checkFirstSentence(view.container);
      await click(view.container, "Check pronunciation");
      expect(first.abort).toHaveBeenCalled();
      expect(FakeRecognition.instances).toHaveLength(2);
      expect(buttonsNamed(view.container, "Listening…")).toHaveLength(1);
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(2);
      expect(view.container.textContent).not.toContain("aborted");
      expect(buttonsNamed(view.container, "Try again")).toHaveLength(0);
    });

    it("disables Listen, Loop and Compare in the listening sentence and stops speech", async () => {
      installMediaDevices(async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream);
      installObjectUrlFakes();
      vi.stubGlobal(
        "MediaRecorder",
        class {
          state = "inactive";
          mimeType = "audio/webm";
          ondataavailable: ((event: BlobEvent) => void) | null = null;
          onstop: (() => void) | null = null;
          start() {
            this.state = "recording";
          }
          stop() {
            this.state = "inactive";
            this.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent);
            this.onstop?.();
          }
        },
      );
      const view = await openShadow();
      await enable(view.container);
      await click(view.container, "Record");
      await click(view.container, "Stop");
      expect(buttonsNamed(view.container, "Compare")[0]?.disabled).toBe(false);
      expect(buttonsNamed(view.container, "Listen")[0]?.disabled).toBe(false);
      expect(buttonsNamed(view.container, "Loop")[0]?.disabled).toBe(false);
      const speech = window.speechSynthesis as unknown as { cancel: ReturnType<typeof vi.fn> };
      speech.cancel.mockClear();
      await checkFirstSentence(view.container);
      expect(speech.cancel).toHaveBeenCalled();
      expect(buttonsNamed(view.container, "Listen")[0]?.disabled).toBe(true);
      expect(buttonsNamed(view.container, "Loop")[0]?.disabled).toBe(true);
      expect(buttonsNamed(view.container, "Compare")[0]?.disabled).toBe(true);
      expect(buttonsNamed(view.container, "Listen")[1]?.disabled).toBe(false);
      expect(buttonsNamed(view.container, "Loop")[1]?.disabled).toBe(false);
    });

    it.each([
      ["result", (recognition: FakeRecognition) =>
        recognition.onresult?.({ results: [[{ transcript: "good morning how are you today" }]] })],
      ["error", (recognition: FakeRecognition) => recognition.onerror?.({ error: "network" })],
    ])("ignores a late %s from a recognition dropped by turning the setting off", async (_name, settle) => {
      const view = await openShadow();
      expect(await actionsToday()).toBe(0);
      await enable(view.container);
      const recognition = await checkFirstSentence(view.container);
      // The recognition settles before the toggle, but its handler runs only after
      // the toggle's cleanup has dropped this recognition.
      settle(recognition);
      const toggle = buttonsNamed(view.container, "Pronunciation check")[0];
      if (!toggle) throw new Error("Pronunciation check button not found");
      harnessActSync(() => {
        toggle.click();
      });
      await harnessAct(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(view.container.textContent).not.toContain("Reference:");
      expect(view.container.textContent).not.toContain("Speech recognition couldn't reach its service.");
      expect(await actionsToday()).toBe(0);
      await close(view);
    });

    it("keeps dictation wording as you typed with the setting on", async () => {
      const view = await openShadow();
      await enable(view.container);
      await click(view.container, "Dictation");
      const input = view.container.querySelector<HTMLInputElement>(
        `#dictation-${greetingsLesson.sentences[0].id}`,
      );
      if (!input) throw new Error("dictation input not found");
      await submitInput(input, "Good morning, how are you tomorrow?");
      expect(view.container.textContent).toContain("Not quite: 5 of 6 words matched");
      expect(view.container.textContent).toContain('today (you typed "tomorrow")');
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(0);
    });
  });

  describe("practice robustness", () => {
    class Recognition {
      static instances: Recognition[] = [];
      lang = "";
      continuous = true;
      interimResults = true;
      maxAlternatives = 5;
      processLocally = false;
      onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      abort = vi.fn();
      constructor() {
        Recognition.instances.push(this);
      }
    }

    class Recorder {
      static instances: Recorder[] = [];
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor() {
        Recorder.instances.push(this);
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent);
        this.onstop?.();
      }
    }

    // Speech, recognition (with the check on) and recording, all faked.
    async function openPractice(lesson = greetingsLesson) {
      const speech = installSpeechFakes();
      Recognition.instances = [];
      Recorder.instances = [];
      vi.stubGlobal("webkitSpeechRecognition", Recognition);
      installMediaDevices(async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream);
      installObjectUrlFakes();
      vi.stubGlobal("MediaRecorder", Recorder);
      localStorage.setItem("road-to-english.pronunciationCheck", "on");
      const view = await openLesson(lesson);
      localStorage.removeItem("road-to-english.pronunciationCheck");
      return { ...view, speech };
    }

    const spokenWords = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('[aria-current="true"]')).map((element) => element.textContent);

    const settle = () =>
      harnessAct(async () => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      });

    afterEach(() => {
      vi.useRealTimers();
      localStorage.clear();
    });

    it("awards recording practice only for a clip of at least one second", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const view = await openPractice();
      const { container } = view;
      expect(await actionsToday()).toBe(0);
      await click(container, "Record");
      vi.setSystemTime(Date.now() + 999);
      await click(container, "Stop");
      await settle();
      expect(container.querySelector("audio")?.getAttribute("src")).toMatch(/^blob:/);
      expect(await actionsToday()).toBe(0);

      await click(container, "Record");
      vi.setSystemTime(Date.now() + 1000);
      await click(container, "Stop");
      await waitForActions(1);
      await settle();
      expect(await actionsToday()).toBe(1);
    });

    it("runs one practice medium at a time across sentences", async () => {
      const view = await openPractice();
      const { container, speech } = view;

      await click(container, "Listen");
      await click(container, "Check pronunciation");
      const firstCheck = Recognition.instances.at(-1)!;
      expect(speech.cancel).toHaveBeenCalled();

      // Record in sentence 2 stops the check in sentence 1 and any speech.
      speech.cancel.mockClear();
      await click(container, "Record", 1);
      await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
      expect(firstCheck.abort).toHaveBeenCalledOnce();
      expect(buttonsNamed(container, "Listening…")).toHaveLength(0);
      expect(speech.cancel).toHaveBeenCalled();

      // Check in sentence 1 stops the recording in sentence 2.
      await click(container, "Check pronunciation");
      expect(Recorder.instances[0]?.state).toBe("inactive");
      expect(buttonsNamed(container, "Stop")).toHaveLength(0);
      expect(container.querySelectorAll("audio")).toHaveLength(1);
      const secondCheck = Recognition.instances.at(-1)!;

      // Listen in sentence 3 stops the check in sentence 1.
      await click(container, "Listen", 2);
      expect(secondCheck.abort).toHaveBeenCalledOnce();
      expect(speech.spoken.at(-1)?.text).toBe(greetingsLesson.sentences[2].text);

      // Record stops a Loop in another sentence; Listen stops a recording.
      await click(container, "Loop");
      expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("true");
      speech.cancel.mockClear();
      await click(container, "Record", 2);
      await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
      expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
      expect(speech.cancel).toHaveBeenCalled();
      await click(container, "Listen", 1);
      expect(Recorder.instances.at(-1)?.state).toBe("inactive");
      expect(buttonsNamed(container, "Stop")).toHaveLength(0);
    });

    it("pauses Compare's recording when Listen starts in another sentence", async () => {
      const view = await openPractice();
      const { container, speech } = view;
      const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
      const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

      await click(container, "Record");
      await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
      await click(container, "Stop");
      await click(container, "Compare");
      await harnessAct(async () => {
        speech.finish();
        speech.spoken.at(-1)?.onend?.();
      });
      expect(play).toHaveBeenCalledOnce();
      pause.mockClear();

      await click(container, "Listen", 1);
      expect(pause).toHaveBeenCalled();
    });

    it("stops speech and Loop when the recording plays from its own controls", async () => {
      const view = await openPractice();
      const { container, speech } = view;
      const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

      await click(container, "Record");
      await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
      await click(container, "Stop");
      await click(container, "Loop", 1);
      expect(buttonsNamed(container, "Loop")[1]?.getAttribute("aria-pressed")).toBe("true");
      speech.cancel.mockClear();
      pause.mockClear();

      await harnessAct(async () => {
        container.querySelector("audio")?.dispatchEvent(new Event("play"));
      });
      expect(buttonsNamed(container, "Loop")[1]?.getAttribute("aria-pressed")).toBe("false");
      expect(speech.cancel).toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
    });

    it("turns Loop off on a speech error, plays the recording after a failed Compare reference, and explains a failed Listen once", async () => {
      const view = await openPractice();
      const { container, speech } = view;
      const message = "Couldn't play the sentence. Check your browser's speech settings.";
      const occurrences = () => container.textContent?.split(message).length ?? 1;
      const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

      await click(container, "Loop");
      await harnessAct(async () => {
        speech.spoken.at(-1)?.onerror?.({ error: "synthesis-failed" });
      });
      expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
      const spoken = speech.spoken.length;
      await harnessAct(async () => {
        speech.finish();
        speech.spoken.at(-1)?.onend?.();
      });
      expect(speech.spoken).toHaveLength(spoken);

      await click(container, "Listen");
      expect(container.textContent).not.toContain(message);
      await harnessAct(async () => {
        speech.spoken.at(-1)?.onboundary?.({ name: "word", charIndex: 0 });
      });
      expect(spokenWords(container)).toEqual(["Good"]);
      await harnessAct(async () => {
        speech.spoken.at(-1)?.onerror?.({ error: "synthesis-failed" });
        speech.spoken.at(-1)?.onerror?.({ error: "synthesis-failed" });
      });
      expect(occurrences()).toBe(2);
      expect(spokenWords(container)).toEqual([]);

      // Our own supersede is silent.
      await click(container, "Listen", 1);
      const superseded = speech.spoken.at(-1);
      await click(container, "Listen", 2);
      await harnessAct(async () => {
        superseded?.onerror?.({ error: "interrupted" });
      });
      expect(container.textContent?.split(message).length).toBe(2);
      expect(buttonsNamed(container, "Listen").map((_, index) => index)).toHaveLength(3);

      await click(container, "Record");
      await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
      await click(container, "Stop");
      await click(container, "Compare");
      expect(play).not.toHaveBeenCalled();
      await harnessAct(async () => {
        speech.spoken.at(-1)?.onerror?.({ error: "audio-busy" });
      });
      expect(play).toHaveBeenCalledOnce();
    });

    it("clears the spoken-word highlight when another medium starts or the sentence is left", async () => {
      const view = await openPractice();
      const { container, speech } = view;
      const highlight = async () => {
        await click(container, "Listen");
        await harnessAct(async () => {
          speech.spoken.at(-1)?.onboundary?.({ name: "word", charIndex: 0 });
        });
        expect(spokenWords(container)).toEqual(["Good"]);
      };

      await highlight();
      await click(container, "Record", 1);
      await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
      expect(spokenWords(container)).toEqual([]);

      await highlight();
      await click(container, "Check pronunciation", 2);
      expect(spokenWords(container)).toEqual([]);

      await highlight();
      await click(container, "morning");
      await click(container, "Hear word");
      expect(spokenWords(container)).toEqual([]);

      await highlight();
      await click(container, "Dictation");
      await click(container, "Shadow");
      expect(spokenWords(container)).toEqual([]);
    });

    it("counts each non-empty sentence check once per lesson visit", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const view = await openPractice();
      const { container } = view;
      const first = greetingsLesson.sentences[0];
      expect(await actionsToday()).toBe(0);
      const submit = async (selector: string, value: string) => {
        const input = container.querySelector<HTMLInputElement>(selector);
        if (!input) throw new Error(`${selector} not found`);
        await submitInput(input, value);
        await settle();
      };
      const goal = async (count: number) => expect(await actionsToday()).toBe(count);

      await click(container, "Check pronunciation");
      await harnessAct(async () => {
        Recognition.instances.at(-1)?.onresult?.({ results: [[{ transcript: "  " }]] });
      });
      await settle();
      await goal(0);
      await click(container, "Try again");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await click(container, "Check pronunciation");
        await harnessAct(async () => {
          Recognition.instances.at(-1)?.onresult?.({ results: [[{ transcript: "good morning" }]] });
        });
        await settle();
        await goal(1);
        await click(container, "Try again");
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await click(container, "Record");
        await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
        vi.setSystemTime(Date.now() + 1000);
        await click(container, "Stop");
        await settle();
        await goal(2);
      }

      await click(container, "Dictation");
      await submit(`#dictation-${first.id}`, "   ");
      await goal(2);
      await submit(`#dictation-${first.id}`, "good morning");
      await goal(3);
      await click(container, "Try again");
      await submit(`#dictation-${first.id}`, first.text);
      await goal(3);

      await click(container, "Fill the blank");
      await submit(`#blank-${first.id}`, "");
      await goal(3);
      await submit(`#blank-${first.id}`, "evening");
      await goal(4);
      await click(container, "Try again");
      await submit(`#blank-${first.id}`, "morning");
      await goal(4);
    });

    it("looks up and links a word with its apostrophe but saves the normalised word", async () => {
      const lesson = {
        ...greetingsLesson,
        sentences: [{ ...greetingsLesson.sentences[0], text: "Don’t worry about it." }, ...greetingsLesson.sentences.slice(1)],
      };
      const view = await openPractice(lesson);
      const { container } = view;
      const api = fetchMock.getMockImplementation()!;
      const dictionaryUrls: string[] = [];
      fetchMock.mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("https://api.dictionaryapi.dev/")) {
          dictionaryUrls.push(url);
          return new Response("[]", { status: 404 });
        }
        return api(input, init);
      });

      await click(container, "Don’t");
      await click(container, "Define");
      await waitForCondition(() => container.textContent?.includes("No definition") ?? false);
      expect(dictionaryUrls).toEqual(["https://api.dictionaryapi.dev/api/v2/entries/en/don't"]);
      const link = Array.from(container.querySelectorAll("a")).find((anchor) => anchor.textContent?.startsWith("Hear it on YouGlish"));
      expect(link?.getAttribute("href")).toBe("https://youglish.com/pronounce/don't/english");

      await click(container, "Save word");
      await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
      const [card] = await getAllCards();
      expect(card?.source.word).toBe("dont");
    });

    it("looks up and links a word without its surrounding quote marks", async () => {
      const lesson = {
        ...greetingsLesson,
        sentences: [
          { ...greetingsLesson.sentences[0], text: "She said 'hello' to the students' teacher." },
          ...greetingsLesson.sentences.slice(1),
        ],
      };
      const view = await openPractice(lesson);
      const { container } = view;
      const api = fetchMock.getMockImplementation()!;
      const dictionaryUrls: string[] = [];
      fetchMock.mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("https://api.dictionaryapi.dev/")) {
          dictionaryUrls.push(url);
          return new Response("[]", { status: 404 });
        }
        return api(input, init);
      });
      const youglish = () =>
        Array.from(container.querySelectorAll("a")).find((anchor) => anchor.textContent?.startsWith("Hear it on YouGlish"));

      for (const [token, word] of [["'hello'", "hello"], ["students'", "students"]]) {
        await click(container, token);
        await click(container, "Define");
        await waitForCondition(() => dictionaryUrls.length > 0);
        expect(dictionaryUrls.splice(0)).toEqual([`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`]);
        expect(youglish()?.getAttribute("href")).toBe(`https://youglish.com/pronounce/${word}/english`);
      }
    });

    it("says the dictionary is unreachable on a network failure", async () => {
      const view = await openPractice();
      const { container } = view;
      const api = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("https://api.dictionaryapi.dev/")) {
          throw new TypeError("Failed to fetch");
        }
        return api(input, init);
      });
      await click(container, "morning");
      await click(container, "Define");
      await waitForCondition(
        () => container.textContent?.includes("Couldn't reach the dictionary. Check your connection.") ?? false,
      );
      expect(container.textContent).not.toContain("No definition");
    });

    it("turns off autocomplete, autocorrect, autocapitalise and spellcheck on the answer inputs", async () => {
      const view = await openPractice();
      const { container } = view;
      const id = greetingsLesson.sentences[0].id;
      for (const [mode, selector] of [["Dictation", `#dictation-${id}`], ["Fill the blank", `#blank-${id}`]]) {
        await click(container, mode);
        const input = container.querySelector<HTMLInputElement>(selector);
        expect(input?.getAttribute("autocomplete")).toBe("off");
        expect(input?.getAttribute("autocorrect")).toBe("off");
        expect(input?.getAttribute("autocapitalize")).toBe("off");
        expect(input?.getAttribute("spellcheck")).toBe("false");
      }
    });

    it("plays dictation and blank sentences at the selected speed", async () => {
      const view = await openPractice();
      const { container, speech } = view;
      await click(container, "0.5x");
      for (const mode of ["Dictation", "Fill the blank"]) {
        await click(container, mode);
        await click(container, "Play");
        // 90 WPM is rate 0.5, halved by the 0.5x speed.
        expect(speech.spoken.at(-1)?.rate).toBe(0.25);
      }
    });
  });

  it("keeps the hide-text switch for the visit when storage is blocked", async () => {
    blockStorage();
    installSpeechFakes();
    const view = await openLesson();
    const autoHide = () => view.container.querySelector<HTMLInputElement>('input[role="switch"]')!;
    expect(autoHide().checked).toBe(false);
    await harnessAct(async () => {
      autoHide().click();
    });
    expect(autoHide().checked).toBe(true);
    await harnessAct(async () => {
      autoHide().click();
    });
    expect(autoHide().checked).toBe(false);
  });

  describe("hide text", () => {
    const AUTO_HIDE_KEY = "road-to-english.autoHideText";
    const autoHideSwitch = (container: HTMLElement) =>
      container.querySelector<HTMLInputElement>('input[role="switch"]');
    const card = (container: HTMLElement, index: number) =>
      container.querySelectorAll<HTMLElement>("ol > li")[index];

    afterEach(() => {
      localStorage.clear();
    });

    it("hides one sentence's text, notes and translation and keeps its practice controls", async () => {
      installSpeechFakes();
      const view = await openLesson();
      await click(view.container, "Vietnamese");
      const third = greetingsLesson.sentences[2];
      const toggle = buttonsNamed(view.container, "Text")[2];
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      toggle.focus();
      await harnessAct(async () => {
        toggle.click();
      });

      expect(toggle.getAttribute("aria-pressed")).toBe("false");
      expect(buttonsNamed(view.container, "Text")[2]).toBe(toggle);
      expect(document.activeElement).toBe(toggle);
      const hidden = card(view.container, 2);
      expect(hidden.textContent).not.toContain("tomorrow");
      expect(hidden.textContent).not.toContain(third.notes);
      expect(hidden.textContent).not.toContain(third.vi);
      expect(buttonsNamed(hidden, "Listen")).toHaveLength(1);
      expect(buttonsNamed(hidden, "Loop")).toHaveLength(1);
      expect(buttonsNamed(hidden, "Record")).toHaveLength(1);
      expect(card(view.container, 0).textContent).toContain("morning");

      await harnessAct(async () => {
        toggle.click();
      });
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      expect(document.activeElement).toBe(toggle);
      expect(card(view.container, 2).textContent).toContain(third.notes);
    });

    it("keeps the global transcript toggle hiding every sentence", async () => {
      installSpeechFakes();
      const view = await openLesson();
      await click(view.container, "Transcript");
      await click(view.container, "Text");
      await click(view.container, "Text");
      expect(card(view.container, 0).textContent).not.toContain("morning");
    });

    it("hides a sentence after its first check when the remembered switch is on, per visit", async () => {
      installSpeechFakes();
      const instances: { onresult: ((event: unknown) => void) | null; onend: (() => void) | null }[] = [];
      vi.stubGlobal(
        "webkitSpeechRecognition",
        class {
          lang = "";
          processLocally = false;
          onresult: ((event: unknown) => void) | null = null;
          onerror = null;
          onend: (() => void) | null = null;
          start = vi.fn();
          abort = vi.fn();
          constructor() {
            instances.push(this);
          }
        },
      );
      localStorage.setItem("road-to-english.pronunciationCheck", "on");
      const view = await openLesson();
      const input = autoHideSwitch(view.container);
      expect(input?.checked).toBe(false);
      await clickElement(input, "auto-hide switch");
      expect(localStorage.getItem(AUTO_HIDE_KEY)).toBe("on");

      await click(view.container, "Check pronunciation");
      await harnessAct(async () => {
        instances.at(-1)?.onresult?.({ results: [[{ transcript: "good morning how are you today" }]] });
        instances.at(-1)?.onend?.();
      });
      expect(card(view.container, 0).textContent).toContain("The browser matched 6 of 6 words");
      expect(buttonsNamed(card(view.container, 0), "morning")).toHaveLength(0);
      expect(buttonsNamed(card(view.container, 0), "Text")[0]?.getAttribute("aria-pressed")).toBe("false");
      expect(card(view.container, 1).textContent).toContain("nice");

      await click(card(view.container, 0), "Text");
      await click(view.container, "Try again");
      await click(view.container, "Check pronunciation");
      await harnessAct(async () => {
        instances.at(-1)?.onresult?.({ results: [[{ transcript: "good morning" }]] });
      });
      expect(buttonsNamed(card(view.container, 0), "Text")[0]?.getAttribute("aria-pressed")).toBe("true");
      await close(view);

      // The URL still routes to the lesson, so the remount opens it directly.
      const again = await renderApp();
      expect(autoHideSwitch(again.container)?.checked).toBe(true);
      expect(buttonsNamed(again.container, "Text").map((toggle) => toggle.getAttribute("aria-pressed"))).toEqual(["true", "true", "true"]);
      await clickElement(autoHideSwitch(again.container), "auto-hide switch");
      expect(localStorage.getItem(AUTO_HIDE_KEY)).toBeNull();
    });
  });
});
