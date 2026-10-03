import { useEffect, useState } from "react";

import * as stylex from "@stylexjs/stylex";

const BARS = 48;
const MAX_HEIGHT = 32;

const styles = stylex.create({
  wave: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    height: `${MAX_HEIGHT}px`,
    maxWidth: "100%",
    overflow: "hidden",
  },
  bar: {
    flex: "0 1 4px",
    minWidth: "1px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--rte-color-speak)",
  },
});

// Peak amplitude of each of `count` equal slices of the first channel, scaled so the loudest is 1.
export function peaks(samples: Float32Array, count: number): number[] {
  const size = Math.max(1, Math.floor(samples.length / count));
  const result: number[] = [];
  for (let bar = 0; bar < count; bar++) {
    let peak = 0;
    for (let i = bar * size; i < Math.min(samples.length, (bar + 1) * size); i++) {
      peak = Math.max(peak, Math.abs(samples[i]));
    }
    result.push(peak);
  }
  const loudest = Math.max(...result, 0);
  return loudest > 0 ? result.map((peak) => peak / loudest) : result;
}

// An offline context only decodes: it opens no audio device and needs no closing.
async function decodePeaks(url: string): Promise<number[]> {
  const data = await (await fetch(url)).arrayBuffer();
  const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data);
  return peaks(audio.getChannelData(0), BARS);
}

// The learner's recording drawn as orange bars, beside its player. Decorative: the player is the control.
// Nothing shows where the browser cannot decode the clip.
export function RecordingWaveform({ url }: { url: string }) {
  const [wave, setWave] = useState<{ url: string; peaks: number[] } | null>(null);

  useEffect(() => {
    if (typeof OfflineAudioContext === "undefined") return;
    let cancelled = false;
    decodePeaks(url).then(
      (result) => {
        if (!cancelled) setWave({ url, peaks: result });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!wave || wave.url !== url || wave.peaks.every((peak) => peak === 0)) return null;
  return (
    <div aria-hidden="true" data-testid="recording-waveform" className={stylex.props(styles.wave).className}>
      {wave.peaks.map((peak, index) => (
        <span
          key={index}
          className={stylex.props(styles.bar).className}
          style={{ height: Math.max(2, Math.round(peak * MAX_HEIGHT)) }}
        />
      ))}
    </div>
  );
}
