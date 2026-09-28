import { useEffect, useId, useReducer, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Kbd } from "@astryxdesign/core/Kbd";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { Alert, Status } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import { useSayIt } from "../hooks/useSayIt";
import { WordDiffResult } from "../lesson/SentenceQuiz";
import { PRONUNCIATION_CHECK_KEY, readPref, writePref } from "../lib/prefs";
import { recognitionSupported } from "../lib/recognition";
import { speak, speechSupported, stopSpeaking } from "../lib/speech";
import { splitWords, wordIndexAtChar } from "../lib/words";
import {
  formatInterval,
  GRADES,
  NEW_CARDS_PER_DAY,
  previewIntervals,
  Rating,
  splitCardBack,
  State,
  type Grade,
  type VocabCard,
} from "../lib/vocab";
import { addRating, EMPTY_RECAP, GRADE_NAMES, recapLine, type Recap } from "./recap";

const cardFlip = stylex.keyframes({
  from: { transform: "perspective(1000px) rotateY(-90deg)" },
  to: { transform: "perspective(1000px) rotateY(0deg)" },
});

const styles = stylex.create({
  reviewCard: {
    padding: "var(--spacing-6)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-surface)",
  },
  cardFlip: {
    animationName: cardFlip,
    animationDuration: "var(--duration-slow)",
    animationTimingFunction: "var(--rte-ease-emphasized)",
    animationIterationCount: 1,
  },
  summaryCard: {
    padding: "var(--spacing-3)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-surface)",
  },
  breakdown: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "var(--spacing-1)",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  breakdownItem: {
    display: "flex",
    justifyContent: "space-between",
    gap: "var(--spacing-1)",
    minWidth: 0,
    padding: "var(--spacing-1) var(--spacing-2)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-body)",
    fontWeight: "var(--font-weight-semibold)",
  },
  breakdownAgain: { color: "var(--color-error)" },
  breakdownHard: { color: "var(--color-warning)" },
  breakdownGood: { color: "var(--color-success)" },
  breakdownEasy: { color: "var(--color-accent)" },
  breakdownMuted: { color: "var(--color-text-secondary)" },
  spokenWord: {
    backgroundColor: "var(--color-warning-muted)",
  },
  answer: {
    padding: "var(--spacing-4)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-body)",
  },
  ratingRow: {
    containerType: "inline-size",
  },
  // Four ratings in a row when 4.5rem columns fit, else 2x2: never a lone rating on its own row.
  ratingGrid: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(2, minmax(0, 1fr))",
      "@container (min-width: 19.5rem)": "repeat(4, minmax(0, 1fr))",
    },
    gap: "var(--spacing-2)",
  },
  // The interval sits under the grade word.
  rating: {
    flexDirection: "column",
    gap: 0,
    height: "auto",
  },
  ratingAgain: {
    "--color-text-primary": "var(--color-error)",
    backgroundColor: "var(--color-error-muted)",
    boxShadow: "inset 0 0 0 1px var(--color-error)",
  },
  ratingHard: {
    "--color-text-primary": "var(--color-warning)",
    backgroundColor: "var(--color-warning-muted)",
    boxShadow: "inset 0 0 0 1px var(--color-warning)",
  },
  ratingGood: {
    "--color-on-accent": "var(--color-on-success)",
    backgroundColor: "var(--color-success)",
  },
  ratingEasy: {
    "--color-text-primary": "var(--color-accent)",
    backgroundColor: "var(--color-accent-muted)",
    boxShadow: "inset 0 0 0 1px var(--color-accent)",
  },
  ratingDisabled: {
    "--color-text-primary": "var(--color-text-secondary)",
    "--color-on-accent": "var(--color-text-secondary)",
    backgroundColor: "var(--color-background-muted)",
    boxShadow: "inset 0 0 0 1px var(--color-border-emphasized)",
    filter: "saturate(0.2)",
  },
});

type RatingStyle = typeof styles.ratingAgain | typeof styles.ratingHard | typeof styles.ratingGood | typeof styles.ratingEasy;
type BreakdownStyle = typeof styles.breakdownAgain | typeof styles.breakdownHard | typeof styles.breakdownGood | typeof styles.breakdownEasy;

const gradeRatingStyles = {
  [Rating.Again]: styles.ratingAgain,
  [Rating.Hard]: styles.ratingHard,
  [Rating.Good]: styles.ratingGood,
  [Rating.Easy]: styles.ratingEasy,
} satisfies Record<Grade, RatingStyle>;

const gradeBreakdownStyles = {
  [Rating.Again]: styles.breakdownAgain,
  [Rating.Hard]: styles.breakdownHard,
  [Rating.Good]: styles.breakdownGood,
  [Rating.Easy]: styles.breakdownEasy,
} satisfies Record<Grade, BreakdownStyle>;

// No lesson WPM exists for a card; 110 sits mid-way in the seed lessons' 80-150 WPM range.
const LISTEN_WPM = 110;

const LISTEN_FIRST_KEY = "road-to-english.listenFirst";

function listen(text: string, onWord?: (charIndex: number) => void, onFinish?: () => void) {
  speak(text, LISTEN_WPM, 1, { onWord, onEnd: onFinish, onError: onFinish });
}

function SpokenText({ text, charIndex }: { text: string; charIndex: number | null }) {
  const spokenIndex = wordIndexAtChar(text, charIndex);
  return (
    <>
      {splitWords(text).map((part, index) => {
        const spoken = spokenIndex === index;
        return (
          <span key={index} aria-current={spoken ? "true" : undefined} {...stylex.props(spoken && styles.spokenWord)}>
            {part}
          </span>
        );
      })}
    </>
  );
}

// Speech from a card stops when the card is rated, replaced or unmounted.
function stopListening() {
  if (speechSupported()) {
    stopSpeaking();
  }
}

// A visible key hint beside its button (a Kbd inside a primary button fails contrast); the button's
// aria-keyshortcuts carries it for assistive tech.
function hint(keys: string) {
  return (
    <span aria-hidden="true">
      <Kbd keys={keys} />
    </span>
  );
}

const TEXT_TARGETS = "input, textarea";

function CardBack({ card }: { card: VocabCard }) {
  const split = splitCardBack(card);
  if (split === null) {
    return card.back;
  }
  return (
    <>
      {split.before}
      <span lang="vi">{split.vi}</span>
      {split.after}
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
  const [spokenWord, setSpokenWord] = useState<{ surface: string; charIndex: number; cardTurn: string | null } | null>(null);
  const [recap, setRecap] = useState<Recap>(EMPTY_RECAP);
  const intervalIds = useId();
  const isRatingRef = useRef(false);
  // Show answer and rating remove the focused button, so focus moves to what replaced it.
  const [focusTarget, setFocusTarget] = useState<"answer" | "prompt" | null>(null);
  const answerRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLElement>(null);
  const card = due[0];
  const cardTurn = card ? `${card.id}@${card.updatedAt}` : null;
  const showAnswer = cardTurn !== null && revealedFor === cardTurn;
  const canSpeak = speechSupported();
  const [listenFirstPref, setListenFirstPref] = useState(() => readPref(LISTEN_FIRST_KEY) === "on");
  const listenFirst = canSpeak && listenFirstPref;
  const canSayIt = readPref(PRONUNCIATION_CHECK_KEY) === "on" && recognitionSupported();
  const stopReviewSpeech = () => {
    setSpokenWord(null);
    stopListening();
  };

  useEffect(() => {
    if (focusTarget === null) {
      return;
    }
    (focusTarget === "answer" ? answerRef : promptRef).current?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  useEffect(() => stopListening, [cardTurn]);

  const startListening = (text: string, surface: string) => {
    setSpokenWord(null);
    listen(
      text,
      (charIndex) => setSpokenWord({ surface, charIndex, cardTurn }),
      () => setSpokenWord(null),
    );
  };

  // Listen first speaks each card as it is first shown, or as the switch turns on.
  useEffect(() => {
    if (card && listenFirst && !showAnswer) {
      stopReviewSpeech();
      listen(card.front);
    }
  }, [cardTurn, listenFirst, showAnswer]);

  const { sayItState, sayItRef, startSayIt, sayItAgain } = useSayIt(cardTurn, showAnswer, stopReviewSpeech);

  // The interval labels count from now, so they re-render once a minute while the answer is shown.
  const [, refreshIntervals] = useReducer((ticks: number) => ticks + 1, 0);
  useEffect(() => {
    if (!showAnswer) {
      return;
    }
    const timer = setInterval(refreshIntervals, 60_000);
    return () => clearInterval(timer);
  }, [showAnswer]);

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
    const recapTotal = GRADES.reduce((sum, grade) => sum + recap.counts[grade], 0);
    const endMessage = !hasCards
      ? "Nothing to review yet. Save a sentence or a word from a lesson to build your deck."
      : hiddenNew > 0
        ? `Daily limit of ${NEW_CARDS_PER_DAY} new cards reached. ${hiddenNew} new card${hiddenNew === 1 ? " is" : "s are"} waiting.`
        : nextDueInMinutes !== null
          ? `All caught up. Next card in ${nextDueInMinutes} min.`
          : "All caught up. Come back later for your next review.";
    return (
      <VStack gap={2}>
        {rateErrorLine}
        {recapTotal === 0 ? (
          <Text as="p" ref={promptRef} tabIndex={-1}>
            {endMessage}
          </Text>
        ) : (
          <Card padding={3} xstyle={styles.summaryCard}>
            <VStack gap={2}>
              <Text as="p" ref={promptRef} tabIndex={-1}>
                {recapLine(recap)}
                {endMessage}
              </Text>
              <ul aria-label="Session rating breakdown" {...stylex.props(styles.breakdown)}>
                {GRADES.map((grade) => (
                  <li
                    key={grade}
                    {...stylex.props(
                      styles.breakdownItem,
                      recap.counts[grade] === 0 ? styles.breakdownMuted : gradeBreakdownStyles[grade],
                    )}
                  >
                    <span>{GRADE_NAMES[grade]}</span>{" "}
                    <span>{recap.counts[grade]}</span>
                  </li>
                ))}
              </ul>
            </VStack>
          </Card>
        )}
        {recap.again.length > 0 && (
          <List header={<Heading level={2}>Rated Again</Heading>}>
            {recap.again.map(({ id, front }) => {
              const surface = `recap:${id}`;
              const charIndex = spokenWord?.surface === surface ? spokenWord.charIndex : null;
              return (
                <ListItem
                  key={id}
                  label={<Text><SpokenText text={front} charIndex={charIndex} /></Text>}
                  endContent={
                    canSpeak && <Button label={`Listen to ${front}`} variant="secondary" onClick={() => startListening(front, surface)}>Listen</Button>
                  }
                />
              );
            })}
          </List>
        )}
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
    stopReviewSpeech();
    // Read before rating: the review moves the card out of New.
    const newCard = card.fsrs.state === State.New;
    setRateError(null);
    try {
      if (await review(card, rating)) {
        setRecap((current) => addRating(current, card, rating));
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

  const reveal = () => {
    setRevealedFor(cardTurn);
    setFocusTarget("answer");
  };

  const now = Date.now();
  const intervals = showAnswer ? previewIntervals(card, new Date(now)) : null;

  // Shortcuts fire only while focus is inside the card. A text field keeps every key; a focused
  // button keeps Space and Enter for its native activation.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat ||
      target.closest(TEXT_TARGETS) !== null
    ) {
      return;
    }
    if (!showAnswer && (event.key === " " || event.key === "Enter")) {
      if (target.closest("button") !== null) {
        return;
      }
      reveal();
    } else if (showAnswer && /^[1-4]$/.test(event.key)) {
      void rate(GRADES[Number(event.key) - 1]!);
    } else if (canSpeak && event.key.toLowerCase() === "r") {
      startListening(card.front, "card");
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <VStack gap={3}>
      <VStack gap={1}>
        <ToggleButton
          label="Listen first"
          isPressed={listenFirst}
          isDisabled={!canSpeak}
          xstyle={sharedStyles.viewToggle}
          onPressedChange={(pressed) => {
            writePref(LISTEN_FIRST_KEY, pressed ? "on" : null);
            setListenFirstPref(pressed);
          }}
        />
        {!canSpeak && (
          <Text as="p" type="supporting">
            Listen first disabled: speech synthesis is not supported in this browser.
          </Text>
        )}
      </VStack>
      <Card
        padding={3}
        xstyle={[styles.reviewCard, showAnswer && styles.cardFlip]}
        data-review-card
        onKeyDown={onKeyDown}
      >
        <VStack gap={2}>
          <Text as="p" weight="semibold" ref={promptRef} tabIndex={-1}>
            {listenFirst && !showAnswer ? "Listen and recall the card." : <SpokenText text={card.front} charIndex={spokenWord?.surface === "card" && spokenWord.cardTurn === cardTurn ? spokenWord.charIndex : null} />}
          </Text>
          {canSpeak && (
            <HStack gap={1} vAlign="center">
              <Button label="Listen" variant="secondary" aria-keyshortcuts="R" onClick={() => startListening(card.front, "card")} />
              {hint("r")}
            </HStack>
          )}
          {showAnswer && (
            <Text as="p" xstyle={styles.answer} ref={answerRef} tabIndex={-1}><CardBack card={card} /></Text>
          )}
          {canSayIt && !showAnswer && (
            <VStack gap={1}>
              <Button
                ref={sayItRef}
                label={sayItState.status === "listening" ? "Listening…" : "Say it"}
                variant="secondary"
                xstyle={sharedStyles.viewToggle}
                isDisabled={sayItState.status === "listening"}
                tooltip={sayItState.status === "listening" ? "Say the card" : undefined}
                onClick={startSayIt}
              />
              <Status>
                {sayItState.status === "heard" && (
                  <WordDiffResult
                    text={card.front}
                    answer={sayItState.transcript}
                    verb="said"
                    checkId={sayItState.checkId}
                    targetWpm={LISTEN_WPM}
                    speed={1}
                    stopMedia={stopReviewSpeech}
                  />
                )}
                {sayItState.status === "failed" && (
                  <Text as="p" color="primary" xstyle={sharedStyles.error}>
                    {sayItState.message}
                  </Text>
                )}
              </Status>
              {(sayItState.status === "heard" || sayItState.status === "failed") && (
                <Button label="Try again" variant="ghost" xstyle={sharedStyles.viewToggle} onClick={sayItAgain} />
              )}
            </VStack>
          )}
          {!showAnswer ? (
            <HStack gap={1} vAlign="center">
              <Button label="Show answer" variant="primary" aria-keyshortcuts="Space Enter" onClick={reveal} />
              {hint("space")}
            </HStack>
          ) : (
            <div {...stylex.props(styles.ratingRow)}>
              <div {...stylex.props(styles.ratingGrid)}>
                {GRADES.map((grade, index) => (
                  <VStack key={grade} gap={1} hAlign="center">
                    <Button
                      label={GRADE_NAMES[grade]}
                      variant={grade === Rating.Good ? "primary" : "secondary"}
                      xstyle={[styles.rating, gradeRatingStyles[grade], isRating && styles.ratingDisabled]}
                      width="100%"
                      isDisabled={isRating}
                      aria-describedby={`${intervalIds}-${grade}`}
                      aria-keyshortcuts={String(index + 1)}
                      endContent={
                        <span aria-hidden="true" id={`${intervalIds}-${grade}`}>
                          {formatInterval(intervals![grade].getTime() - now)}
                        </span>
                      }
                      onClick={() => void rate(grade)}
                    />
                    {!isRating && hint(String(index + 1))}
                  </VStack>
                ))}
              </div>
            </div>
          )}
          {rateErrorLine}
        </VStack>
      </Card>
    </VStack>
  );
}
