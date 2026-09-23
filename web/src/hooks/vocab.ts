import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createCard,
  deleteCard,
  type Grade,
  type NewCard,
  type VocabCard,
} from "../lib/vocab";
import {
  dueCards,
  getAllCards,
  putCard,
  restoreTombstone,
  saveCard,
  saveReview,
} from "../lib/vocabStore";

// A live card due within this window is refreshed in on time, so a card rated Again comes back in-session.
const NEXT_DUE_WINDOW_MS = 60 * 60_000;

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
  // Earliest future due among live cards, when within the window.
  const nextDueTime = useMemo(() => {
    const nowTime = now.getTime();
    let next: number | null = null;
    for (const card of cards) {
      const dueTime = card.fsrs.due.getTime();
      if (card.deletedAt === null && dueTime > nowTime && dueTime - nowTime <= NEXT_DUE_WINDOW_MS && (next === null || dueTime < next)) {
        next = dueTime;
      }
    }
    return next;
  }, [cards, now]);

  // Re-arms after every refresh (`now`), so a timer that fires before the card is due tries again.
  useEffect(() => {
    if (nextDueTime === null) {
      return;
    }
    const timer = window.setTimeout(() => void refresh(), Math.max(0, nextDueTime - Date.now()));
    return () => window.clearTimeout(timer);
  }, [nextDueTime, now, refresh]);
  const savedCardIds = useMemo(
    () => new Set(cards.filter((card) => card.deletedAt === null).map((card) => card.id)),
    [cards],
  );

  const addCard = useCallback(
    async (input: NewCard) => {
      await saveCard(createCard(input, new Date()));
      await refresh();
    },
    [refresh],
  );

  const review = useCallback(
    // Resolves false, writing nothing, when the stored card changed since `card` was loaded.
    async (card: VocabCard, rating: Grade) => {
      const saved = await saveReview(card, rating, new Date());
      await refresh();
      return saved;
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

  const nextDueInMinutes = nextDueTime === null ? null : Math.ceil((nextDueTime - now.getTime()) / 60_000);

  return { due, nextDueInMinutes, savedCardIds, loading, error, addCard, removeCard, undoRemove, review, reload: refresh };
}
