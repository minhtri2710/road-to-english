import { GRADES, Rating, type Grade, type VocabCard } from "../lib/vocab";

export const GRADE_NAMES: Record<Grade, string> = {
  [Rating.Again]: "Again",
  [Rating.Hard]: "Hard",
  [Rating.Good]: "Good",
  [Rating.Easy]: "Easy",
};

// Ratings saved in this visit, per grade, and the distinct cards rated Again, in first-rated order.
export interface Recap {
  counts: Record<Grade, number>;
  again: { id: string; front: string }[];
}

export const EMPTY_RECAP: Recap = {
  counts: { [Rating.Again]: 0, [Rating.Hard]: 0, [Rating.Good]: 0, [Rating.Easy]: 0 },
  again: [],
};

export function addRating(recap: Recap, card: VocabCard, rating: Grade): Recap {
  return {
    counts: { ...recap.counts, [rating]: recap.counts[rating] + 1 },
    again:
      rating === Rating.Again && !recap.again.some((rated) => rated.id === card.id)
        ? [...recap.again, { id: card.id, front: card.front }]
        : recap.again,
  };
}

// "Reviewed 3 cards: 1 Again, 2 Good. ", or "" before any saved rating.
export function recapLine({ counts }: Recap): string {
  const total = GRADES.reduce((sum, grade) => sum + counts[grade], 0);
  if (total === 0) {
    return "";
  }
  const breakdown = GRADES.filter((grade) => counts[grade] > 0)
    .map((grade) => `${counts[grade]} ${GRADE_NAMES[grade]}`)
    .join(", ");
  return `Reviewed ${total} card${total === 1 ? "" : "s"}: ${breakdown}. `;
}
