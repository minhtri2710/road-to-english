import { useCallback, useEffect, useRef, useState } from "react";

import type { Cue } from "../api/lessons";
import { loadYouTubeApi, type YouTubePlayer } from "../lib/youtube";

// Without a videoId nothing loads, so plain lessons never contact YouTube.
export function useYouTubePlayer(videoId: string | undefined) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const pollRef = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  const stopClip = useCallback(() => {
    window.clearInterval(pollRef.current);
    pollRef.current = undefined;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!videoId || !container) {
      return;
    }
    let cancelled = false;
    let player: YouTubePlayer | null = null;
    // The API replaces this element with its iframe, so React never owns it.
    const mount = document.createElement("div");
    container.append(mount);
    loadYouTubeApi().then(
      (api) => {
        if (cancelled) return;
        player = new api.Player(mount, {
          videoId,
          host: "https://www.youtube-nocookie.com",
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            onReady: () => {
              if (cancelled) return;
              playerRef.current = player;
              setStatus("ready");
            },
            onError: () => {
              if (!cancelled) setStatus("failed");
            },
          },
        });
      },
      () => {
        if (!cancelled) setStatus("failed");
      },
    );
    return () => {
      cancelled = true;
      stopClip();
      playerRef.current = null;
      player?.destroy();
      container.replaceChildren();
      setStatus("loading");
    };
  }, [videoId, stopClip]);

  const playClip = useCallback(
    (cue: Cue, rate: number) => {
      const player = playerRef.current;
      if (!player) return;
      stopClip();
      player.setPlaybackRate(rate);
      player.seekTo(cue.start, true);
      player.playVideo();
      const { end } = cue;
      if (end === null) return;
      // ponytail: a 100ms poll can overshoot the end by up to ~100ms of video; use the player's own end
      // (a per-clip embed with playerVars.end) if clips need frame accuracy.
      pollRef.current = window.setInterval(() => {
        if (player.getCurrentTime() >= end) {
          stopClip();
          player.pauseVideo();
        }
      }, 100);
    },
    [stopClip],
  );

  return { containerRef, status, playClip };
}
