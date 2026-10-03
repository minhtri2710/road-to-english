import { useEffect, useState } from "react";

import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { useT } from "../i18n";
import { soundScore, type SoundScore } from "../lib/soundScore";

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
  soundLine: {
    fontVariantNumeric: "tabular-nums",
  },
});

// Words as the learner says them: tokens holding a letter or digit.
export function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

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
async function decode(url: string, text: string, targetWpm: number): Promise<{ peaks: number[]; sound: SoundScore | null }> {
  const data = await (await fetch(url)).arrayBuffer();
  const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data);
  const samples = audio.getChannelData(0);
  return { peaks: peaks(samples, BARS), sound: soundScore(samples, audio.sampleRate, countWords(text), targetWpm) };
}

const PACE_LABELS = { slow: "a little slow", good: "on pace", fast: "a little fast" } as const;

// The learner's recording drawn as orange bars, beside its player, with a score from its sound: pace against
// the lesson's target and pauses mid-sentence. The bars are decorative: the player is the control.
// Nothing shows where the browser cannot decode the clip.
export function RecordingWaveform({ url, text, targetWpm }: { url: string; text: string; targetWpm: number }) {
  const t = useT();
  const [wave, setWave] = useState<{ url: string; peaks: number[]; sound: SoundScore | null } | null>(null);

  useEffect(() => {
    if (typeof OfflineAudioContext === "undefined") return;
    let cancelled = false;
    decode(url, text, targetWpm).then(
      (result) => {
        if (!cancelled) setWave({ url, ...result });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [url, text, targetWpm]);

  if (!wave || wave.url !== url || wave.peaks.every((peak) => peak === 0)) return null;
  const { sound } = wave;
  return (
    <VStack gap={0.5}>
      <div aria-hidden="true" data-testid="recording-waveform" className={stylex.props(styles.wave).className}>
        {wave.peaks.map((peak, index) => (
          <span
            key={index}
            className={stylex.props(styles.bar).className}
            style={{ height: Math.max(2, Math.round(peak * MAX_HEIGHT)) }}
          />
        ))}
      </div>
      {sound && (
        <Text as="p" type="supporting" data-testid="sound-score" xstyle={styles.soundLine}>
          {t("Sound check {score}: {wpm} WPM, target {target}, {pace}", {
            score: sound.score,
            wpm: sound.wpm,
            target: sound.targetWpm,
            pace: t(PACE_LABELS[sound.pace]),
          })}
          {sound.pauses > 0 && ` · ${t(sound.pauses === 1 ? "1 long pause" : "{count} long pauses", { count: sound.pauses })}`}
        </Text>
      )}
    </VStack>
  );
}
