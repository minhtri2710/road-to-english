import { diffWords } from "./dictation";

// A sentence passes Shadow Gate at this score, which unlocks the next sentence.
export const PASS_SCORE = 70;
// A word scores "good" from this score and "fair" from FAIR_SCORE up.
export const GOOD_SCORE = 80;
export const FAIR_SCORE = 50;

export type WordLevel = "good" | "fair" | "miss";

// One reference word as the learner said it: heard is what the recognizer wrote in its place, if
// anything else.
export interface ScoredWord {
  word: string;
  level: WordLevel;
  score: number;
  heard?: string;
}

export interface ShadowScore {
  words: ScoredWord[];
  score: number;
  passed: boolean;
}

function letters(word: string): string {
  return word.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "");
}

// Character-level similarity in [0, 1]: 1 minus the Levenshtein distance over the longer length.
export function similarity(a: string, b: string): number {
  const x = letters(a);
  const y = letters(b);
  const longest = Math.max(x.length, y.length);
  if (longest === 0) return 1;
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[y.length] / longest;
}

export function wordLevel(score: number): WordLevel {
  if (score >= GOOD_SCORE) return "good";
  if (score >= FAIR_SCORE) return "fair";
  return "miss";
}

// Scores what the recognizer heard against the sentence, word by word: a matched word scores 100,
// a replaced word scores its spelling similarity (a near miss lands in "fair"), a missed word 0.
// Extra words lower nothing, as recognizers often add fillers. The sentence score is the mean.
export function scoreShadow(transcript: string, reference: string): ShadowScore {
  const words: ScoredWord[] = [];
  for (const entry of diffWords(transcript, reference)) {
    if (entry.kind === "correct") {
      words.push({ word: entry.word, level: "good", score: 100 });
    } else if (entry.kind === "replaced") {
      const score = Math.min(GOOD_SCORE - 1, Math.round(similarity(entry.typed, entry.word) * 100));
      words.push({ word: entry.word, level: wordLevel(score), score, heard: entry.typed });
    } else if (entry.kind === "missed") {
      words.push({ word: entry.word, level: "miss", score: 0 });
    }
  }
  const score = words.length === 0 ? 0 : Math.round(words.reduce((sum, word) => sum + word.score, 0) / words.length);
  return { words, score, passed: score >= PASS_SCORE };
}
