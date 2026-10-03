// Scores a recording by its sound, not its words: how fast the learner spoke against the lesson's target pace,
// and how often speech stopped mid-sentence. The words themselves are Pronunciation check's job.

export type Pace = "slow" | "good" | "fast";

export type SoundScore = {
  score: number;
  wpm: number;
  targetWpm: number;
  pace: Pace;
  // Silences of at least PAUSE_SECONDS between the first and last sound.
  pauses: number;
  speechSeconds: number;
};

const FRAME_SECONDS = 0.02;
const PAUSE_SECONDS = 0.35;
// Within this share of the target pace counts as on pace.
const PACE_TOLERANCE = 0.15;

function frameLevels(samples: Float32Array, sampleRate: number): number[] {
  const size = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const levels: number[] = [];
  for (let start = 0; start < samples.length; start += size) {
    let sum = 0;
    const end = Math.min(samples.length, start + size);
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    levels.push(Math.sqrt(sum / (end - start)));
  }
  return levels;
}

// Null when the clip holds too little sound to judge (silence, a tap on the mic).
export function soundScore(samples: Float32Array, sampleRate: number, wordCount: number, targetWpm: number): SoundScore | null {
  if (wordCount <= 0 || targetWpm <= 0 || sampleRate <= 0) return null;
  const levels = frameLevels(samples, sampleRate);
  const loudest = Math.max(0, ...levels);
  if (loudest < 0.005) return null;
  // Voiced: louder than a tenth of the loudest frame, so room noise and breaths stay below it.
  const voiced = levels.map((level) => level >= loudest * 0.1);
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  const speechSeconds = (last - first + 1) * FRAME_SECONDS;
  if (speechSeconds < 0.3) return null;

  let pauses = 0;
  let gap = 0;
  for (let i = first; i <= last; i++) {
    if (voiced[i]) {
      if (gap * FRAME_SECONDS >= PAUSE_SECONDS) pauses++;
      gap = 0;
    } else {
      gap++;
    }
  }

  const wpm = Math.round(wordCount / (speechSeconds / 60));
  const ratio = wpm / targetWpm;
  const pace: Pace = ratio < 1 - PACE_TOLERANCE ? "slow" : ratio > 1 + PACE_TOLERANCE ? "fast" : "good";
  const paceScore = Math.max(0, 100 - Math.max(0, Math.abs(ratio - 1) - PACE_TOLERANCE) * 200);
  // A pause per eight words is a natural breath; each one beyond that costs.
  const extraPauses = Math.max(0, pauses - Math.floor(wordCount / 8));
  const flowScore = Math.max(0, 100 - extraPauses * 25);
  const score = Math.round(paceScore * 0.7 + flowScore * 0.3);
  return { score, wpm, targetWpm, pace, pauses, speechSeconds };
}
