import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createCard,
  deleteCard,
  restoreCard,
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
    () => new Set(cards.filter((card) => card.deletedAt === null).map((card) => card.id)),
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

  // Returns the card as it was before the delete, for Undo.
  const removeCard = useCallback(
    async (id: string) => {
      const card = cards.find((stored) => stored.id === id && stored.deletedAt === null);
      if (!card) {
        throw new Error(`No saved card ${id}`);
      }
      await putCard(deleteCard(card, new Date()));
      await refresh();
      return card;
    },
    [cards, refresh],
  );

  const undoRemove = useCallback(
    async (card: VocabCard) => {
      await putCard(restoreCard(card, new Date()));
      await refresh();
    },
    [refresh],
  );

  return { due, savedCardIds, loading, error, addCard, removeCard, undoRemove, review, reload: refresh };
}
