import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createCard,
  deleteCard,
  reviewCard,
  type Grade,
  type NewCard,
  type VocabCard,
} from "../lib/vocab";
import { dueCards, getAllCards, putCard, restoreTombstone } from "../lib/vocabStore";

export function useVocabDeck() {
  const [cards, setCards] = useState<VocabCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
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

  // Cards that became due while the tab was hidden or unfocused show up on return.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    const onFocus = () => void refresh();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
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

  // Returns the tombstone it wrote, for Undo.
  const removeCard = useCallback(
    async (id: string) => {
      const card = cards.find((stored) => stored.id === id && stored.deletedAt === null);
      if (!card) {
        throw new Error(`No saved card ${id}`);
      }
      const tombstone = deleteCard(card, new Date());
      await putCard(tombstone);
      await refresh();
      return tombstone;
    },
    [cards, refresh],
  );

  // Resolves false, writing nothing, when the card changed since `tombstone` was written.
  const undoRemove = useCallback(
    async (tombstone: VocabCard) => {
      const restored = await restoreTombstone(tombstone, new Date());
      await refresh();
      return restored;
    },
    [refresh],
  );

  return { due, savedCardIds, loading, error, addCard, removeCard, undoRemove, review, reload: refresh };
}
