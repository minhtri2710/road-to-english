import { useEffect, useRef, useState } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { Alert } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import { NEW_CARDS_PER_DAY, Rating, splitCardBack, State, type Grade, type VocabCard } from "../lib/vocab";

const styles = stylex.create({
  reviewCard: {
    padding: "1.5rem",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-surface)",
  },
  answer: {
    padding: "1rem",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-body)",
  },
});

function CardBack({ card }: { card: VocabCard }) {
  const split = splitCardBack(card);
  if (split === null) {
    return card.back;
  }
  return (
    <>
      {`${split.sentence} — `}
      <span lang="vi">{split.vi}</span>
    </>
  );
}

export function ReviewDeck({
  due,
  hiddenNew,
  nextDueInMinutes,
  hasCards,
  loading,
  loadFailed,
  review,
  recordPractice,
  onGoToLibrary,
}: {
  due: VocabCard[];
  hiddenNew: number;
  nextDueInMinutes: number | null;
  hasCards: boolean;
  loading: boolean;
  loadFailed: boolean;
  review: (card: VocabCard, rating: Grade) => Promise<boolean>;
  recordPractice: (options: { newCard: boolean }) => Promise<void>;
  onGoToLibrary: () => void;
}) {
  // The card and rating turn the answer was revealed for: a rating changes updatedAt, so the next card,
  // or the same card back after Again, renders hidden from its first frame.
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  const [isRating, setIsRating] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const isRatingRef = useRef(false);
  // Show answer and rating remove the focused button, so focus moves to what replaced it.
  const [focusTarget, setFocusTarget] = useState<"answer" | "prompt" | null>(null);
  const answerRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLElement>(null);
  const card = due[0];
  const cardTurn = card ? `${card.id}@${card.updatedAt}` : null;
  const showAnswer = cardTurn !== null && revealedFor === cardTurn;

  useEffect(() => {
    if (focusTarget === null) {
      return;
    }
    (focusTarget === "answer" ? answerRef : promptRef).current?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  if (loading) {
    return <Text as="p">Loading review deck...</Text>;
  }

  if (loadFailed) {
    return (
      <VStack gap={2}>
        <Text as="p" ref={promptRef} tabIndex={-1}>
          Your review deck couldn't be loaded.
        </Text>
        <Button label="Go to library" variant="secondary" xstyle={sharedStyles.viewToggle} onClick={onGoToLibrary} />
      </VStack>
    );
  }

  const rateErrorLine = rateError !== null && <Alert>{rateError}</Alert>;

  if (!card) {
    return (
      <VStack gap={2}>
        {rateErrorLine}
        <Text as="p" ref={promptRef} tabIndex={-1}>
          {!hasCards
            ? "Nothing to review yet. Save a sentence or a word from a lesson to build your deck."
            : hiddenNew > 0
              ? `Daily limit of ${NEW_CARDS_PER_DAY} new cards reached. ${hiddenNew} new card${hiddenNew === 1 ? " is" : "s are"} waiting.`
              : nextDueInMinutes !== null
                ? `All caught up. Next card in ${nextDueInMinutes} min.`
                : "All caught up. Come back later for your next review."}
        </Text>
        <Button label="Go to library" variant="secondary" xstyle={sharedStyles.viewToggle} onClick={onGoToLibrary} />
      </VStack>
    );
  }

  const rate = async (rating: Grade) => {
    if (isRatingRef.current) {
      return;
    }

    isRatingRef.current = true;
    setIsRating(true);
    // Read before rating: the review moves the card out of New.
    const newCard = card.fsrs.state === State.New;
    setRateError(null);
    try {
      if (await review(card, rating)) {
        // Resolves even when the write fails; the header storage line reports it.
        await recordPractice({ newCard });
      } else {
        setRateError("This card changed on another device. Showing the latest.");
      }
    } catch {
      setRateError("Couldn't save. Try again.");
    } finally {
      isRatingRef.current = false;
      setIsRating(false);
      // The disabled rating buttons drop focus, so it moves to the card, whether or not the rating saved.
      setFocusTarget("prompt");
    }
  };

  return (
    <VStack gap={3}>
      <Card padding={3} xstyle={styles.reviewCard}>
        <VStack gap={2}>
          <Text as="p" weight="semibold" ref={promptRef} tabIndex={-1}>{card.front}</Text>
          {showAnswer && (
            <Text as="p" xstyle={styles.answer} ref={answerRef} tabIndex={-1}><CardBack card={card} /></Text>
          )}
          {!showAnswer ? (
            <Button
              label="Show answer"
              variant="primary"
              onClick={() => {
                setRevealedFor(cardTurn);
                setFocusTarget("answer");
              }}
            />
          ) : (
            <HStack gap={1}>
              <Button
                label="Again"
                variant="secondary"
                isDisabled={isRating}
                onClick={() => void rate(Rating.Again)}
              />
              <Button
                label="Hard"
                variant="secondary"
                isDisabled={isRating}
                onClick={() => void rate(Rating.Hard)}
              />
              <Button
                label="Good"
                variant="primary"
                isDisabled={isRating}
                onClick={() => void rate(Rating.Good)}
              />
              <Button
                label="Easy"
                variant="secondary"
                isDisabled={isRating}
                onClick={() => void rate(Rating.Easy)}
              />
            </HStack>
          )}
          {rateErrorLine}
        </VStack>
      </Card>
    </VStack>
  );
}
