import type { VocabCard } from "./vocab";

function reviewTime(card: VocabCard): number | null {
  const review = card.fsrs.last_review;
  return review instanceof Date ? review.getTime() : null;
}

// ponytail: LWW on client wall-clock last_review; upgrade = server-assigned per-card version / fsrs merge.
export function newerCard(a: VocabCard, b: VocabCard): boolean {
  const aTime = reviewTime(a);
  const bTime = reviewTime(b);
  if (aTime === null) {
    return bTime !== null;
  }
  return bTime !== null && bTime > aTime;
}
