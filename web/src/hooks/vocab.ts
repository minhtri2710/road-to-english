import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createCard,
  reviewCard,
  type Grade,
  type VocabCard,
} from "../lib/vocab";
import { dueCards, getAllCards, putCard } from "../lib/vocabStore";

export function useVocabDeck() {
  const [cards, setCards] = useState<VocabCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  const refresh = useCallback(async () => {
    setLoading(true);
    const nextCards = await getAllCards();
    setCards(nextCards);
    setNow(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const due = useMemo(() => dueCards(cards, now), [cards, now]);
  const savedSentenceIds = useMemo(
    () => new Set(cards.map((card) => card.source.sentenceId)),
    [cards],
  );

  const addCard = useCallback(
    async (input: {
      front: string;
      back: string;
      source: { lessonId: string; sentenceId: string };
    }) => {
      await putCard(createCard(input, new Date()));
      await refresh();
    },
    [refresh],
  );

  const review = useCallback(
    async (card: VocabCard, rating: Grade) => {
      await putCard(reviewCard(card, rating, new Date()));
      await refresh();
    },
    [refresh],
  );

  return { due, savedSentenceIds, loading, addCard, review, reload: refresh };
}
