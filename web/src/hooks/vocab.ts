import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createCard,
  reviewCard,
  type Grade,
  type NewCard,
  type VocabCard,
} from "../lib/vocab";
import { dueCards, getAllCards, putCard } from "../lib/vocabStore";

export function useVocabDeck() {
  const [cards, setCards] = useState<VocabCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  // ponytail: due-ness advances only on refresh, so cards becoming due while Review is open appear after the next action; upgrade = timer or visibility refresh.
  const [now, setNow] = useState(() => new Date());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCards(await getAllCards());
      setNow(new Date());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError : new Error("Unable to load cards"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const due = useMemo(() => dueCards(cards, now), [cards, now]);
  const savedCardIds = useMemo(
    () => new Set(cards.map((card) => card.id)),
    [cards],
  );

  const addCard = useCallback(
    async (input: NewCard) => {
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

  return { due, savedCardIds, loading, error, addCard, review, reload: refresh };
}
