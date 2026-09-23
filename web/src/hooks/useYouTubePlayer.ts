import { useCallback, useEffect, useRef, useState } from "react";

import type { Cue } from "../api/lessons";
import { loadYouTubeApi, PLAYER_PLAYING, type YouTubePlayer } from "../lib/youtube";

const LOAD_TIMEOUT_MS = 15_000;

// Without a videoId nothing loads, so plain lessons never contact YouTube. onPlay runs
// whenever the video starts playing, from Play clip or the player's own controls.
export function useYouTubePlayer(videoId: string | undefined, onPlay: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
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
    // A player that is not ready in time counts as failed; a late onReady still makes it usable.
    const timeout = window.setTimeout(() => {
      if (!cancelled && !playerRef.current) setStatus("failed");
    }, LOAD_TIMEOUT_MS);
    loadYouTubeApi().then(
      (api) => {
        if (cancelled) return;
        player = new api.Player(mount, {
          videoId,
          host: "https://www.youtube-nocookie.com",
          // The iframe fills the container, which sets the fluid 16:9 box.
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            onReady: () => {
              if (cancelled) return;
              window.clearTimeout(timeout);
              playerRef.current = player;
              setStatus("ready");
            },
            onError: () => {
              if (!cancelled) setStatus("failed");
            },
            onStateChange: (event) => {
              if (!cancelled && event.data === PLAYER_PLAYING) onPlayRef.current();
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
      window.clearTimeout(timeout);
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

  const pauseClip = useCallback(() => {
    stopClip();
    playerRef.current?.pauseVideo();
  }, [stopClip]);

  return { containerRef, status, playClip, pauseClip };
}
