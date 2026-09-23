import type { Cue } from "../api/lessons";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TIMESTAMP = /^(\d+:)?\d{1,2}:\d{2}$/;

export function isYouTubeId(value: unknown): value is string {
  return typeof value === "string" && YOUTUBE_ID.test(value);
}

export function parseYouTubeId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") {
    return null;
  }
  const path = url.pathname.split("/").filter(Boolean);
  let id: string | null | undefined = null;
  if (url.host === "youtu.be") {
    id = path.length === 1 ? path[0] : null;
  } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.host)) {
    if (url.pathname === "/watch") {
      id = url.searchParams.get("v");
    } else if (path.length === 2 && (path[0] === "shorts" || path[0] === "embed")) {
      id = path[1];
    }
  }
  return isYouTubeId(id) ? id : null;
}

// Each timestamp line starts a cue whose text is the following non-empty lines; a cue ends at the next kept cue's start.
export function parseTranscript(text: string): { text: string; cue: Cue }[] {
  const cues: { start: number; lines: string[] }[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const current = cues.at(-1);
    if (TIMESTAMP.test(line)) {
      const start = line.split(":").reduce((total, part) => total * 60 + Number(part), 0);
      if (current && start <= current.start) {
        throw new Error(`Timestamps must increase: ${line} is not after the previous one.`);
      }
      cues.push({ start, lines: [] });
    } else if (current) {
      current.lines.push(line);
    } else {
      throw new Error("The transcript must start with a timestamp.");
    }
  }
  const kept = cues.filter((cue) => cue.lines.length > 0);
  return kept.map((cue, index) => ({
    text: cue.lines.join(" "),
    cue: { start: cue.start, end: kept[index + 1]?.start ?? null },
  }));
}

// Minimal local types for the YouTube IFrame Player API.
export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  destroy(): void;
}

export interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host: string;
      playerVars: { playsinline: 1; rel: 0 };
      events: { onReady: () => void; onError: () => void };
    },
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeApi> | null = null;

// Loads the IFrame API once on demand; a failed load clears the promise so a later lesson can retry.
export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  apiPromise ??= new Promise<YouTubeApi>((resolve, reject) => {
    const script = document.createElement("script");
    window.onYouTubeIframeAPIReady = () => {
      if (window.YT) {
        resolve(window.YT);
      } else {
        reject(new Error("YouTube API missing"));
      }
    };
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      script.remove();
      reject(new Error("YouTube API failed to load"));
    };
    document.head.append(script);
  });
  return apiPromise;
}
