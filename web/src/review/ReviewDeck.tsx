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
import { WordDiffResult } from "../lesson/SentenceQuiz";
import { PRONUNCIATION_CHECK_KEY, readPref, writePref } from "../lib/prefs";
import { recognitionSupported, recognizeOnce } from "../lib/recognition";
import { speak, speechSupported, stopSpeaking } from "../lib/speech";
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
    gap: "0.5rem",
  },
  // The interval sits under the grade word.
  rating: {
    flexDirection: "column",
    gap: 0,
    height: "auto",
  },
});

// No lesson WPM exists for a card; 110 sits mid-way in the seed lessons' 80-150 WPM range.
const LISTEN_WPM = 110;

const LISTEN_FIRST_KEY = "road-to-english.listenFirst";

// A spoken attempt at the current card: informs only, never rates or records practice.
type SayIt =
  | { status: "idle" }
  | { status: "listening" }
  | { status: "heard"; transcript: string }
  | { status: "failed"; message: string };

const GRADE_NAMES: Record<Grade, string> = {
  [Rating.Again]: "Again",
  [Rating.Hard]: "Hard",
  [Rating.Good]: "Good",
  [Rating.Easy]: "Easy",
};

function listen(text: string) {
  speak(text, LISTEN_WPM, 1);
}

// Speech from a card stops when the card is rated, replaced or unmounted.
function stopListening() {
  if (speechSupported()) {
    stopSpeaking();
  }
}

// Ratings saved in this visit, per grade, and the distinct cards rated Again, in first-rated order.
interface Recap {
  counts: Record<Grade, number>;
  again: { id: string; front: string }[];
}

const EMPTY_RECAP: Recap = {
  counts: { [Rating.Again]: 0, [Rating.Hard]: 0, [Rating.Good]: 0, [Rating.Easy]: 0 },
  again: [],
};

function addRating(recap: Recap, card: VocabCard, rating: Grade): Recap {
  return {
    counts: { ...recap.counts, [rating]: recap.counts[rating] + 1 },
    again:
      rating === Rating.Again && !recap.again.some((rated) => rated.id === card.id)
        ? [...recap.again, { id: card.id, front: card.front }]
        : recap.again,
  };
}

// "Reviewed 3 cards: 1 Again, 2 Good. ", or "" before any saved rating.
function recapLine({ counts }: Recap): string {
  const total = GRADES.reduce((sum, grade) => sum + counts[grade], 0);
  if (total === 0) {
    return "";
  }
  const breakdown = GRADES.filter((grade) => counts[grade] > 0)
    .map((grade) => `${counts[grade]} ${GRADE_NAMES[grade]}`)
    .join(", ");
  return `Reviewed ${total} card${total === 1 ? "" : "s"}: ${breakdown}. `;
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
  // The card turn a Say it attempt belongs to; a new turn or Show answer drops it.
  const [sayIt, setSayIt] = useState<{ turn: string | null; state: SayIt }>({ turn: null, state: { status: "idle" } });
  const sayItState: SayIt = sayIt.turn === cardTurn && !showAnswer ? sayIt.state : { status: "idle" };
  const recognitionRef = useRef<ReturnType<typeof recognizeOnce> | null>(null);
  const sayItRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusTarget === null) {
      return;
    }
    (focusTarget === "answer" ? answerRef : promptRef).current?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  useEffect(() => stopListening, [cardTurn]);

  // Listen first speaks each card as it is first shown, or as the switch turns on.
  useEffect(() => {
    if (card && listenFirst && !showAnswer) {
      listen(card.front);
    }
  }, [cardTurn, listenFirst, showAnswer]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [cardTurn, showAnswer],
  );

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
    return (
      <VStack gap={2}>
        {rateErrorLine}
        <Text as="p" ref={promptRef} tabIndex={-1}>
          {recapLine(recap)}
          {!hasCards
            ? "Nothing to review yet. Save a sentence or a word from a lesson to build your deck."
            : hiddenNew > 0
              ? `Daily limit of ${NEW_CARDS_PER_DAY} new cards reached. ${hiddenNew} new card${hiddenNew === 1 ? " is" : "s are"} waiting.`
              : nextDueInMinutes !== null
                ? `All caught up. Next card in ${nextDueInMinutes} min.`
                : "All caught up. Come back later for your next review."}
        </Text>
        {recap.again.length > 0 && (
          <List header={<Heading level={2}>Rated Again</Heading>}>
            {recap.again.map(({ id, front }) => (
              <ListItem
                key={id}
                label={<Text>{front}</Text>}
                endContent={
                  canSpeak && <Button label={`Listen to ${front}`} variant="secondary" onClick={() => listen(front)}>Listen</Button>
                }
              />
            ))}
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
    stopListening();
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

  const startSayIt = () => {
    stopListening();
    const turn = cardTurn;
    setSayIt({ turn, state: { status: "listening" } });
    const recognition = recognizeOnce();
    recognitionRef.current = recognition;
    recognition.result.then(
      (transcript) => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setSayIt({ turn, state: { status: "heard", transcript } });
      },
      (error: Error) => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setSayIt({ turn, state: error.name === "AbortError" ? { status: "idle" } : { status: "failed", message: error.message } });
      },
    );
  };

  // Try again removes itself, so focus goes back to Say it.
  const sayItAgain = () => {
    setSayIt({ turn: cardTurn, state: { status: "idle" } });
    sayItRef.current?.focus();
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
      listen(card.front);
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
      <Card padding={3} xstyle={styles.reviewCard} onKeyDown={onKeyDown}>
        <VStack gap={2}>
          <Text as="p" weight="semibold" ref={promptRef} tabIndex={-1}>
            {listenFirst && !showAnswer ? "Listen and recall the card." : card.front}
          </Text>
          {canSpeak && (
            <HStack gap={1} vAlign="center">
              <Button label="Listen" variant="secondary" aria-keyshortcuts="R" onClick={() => listen(card.front)} />
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
                    targetWpm={LISTEN_WPM}
                    speed={1}
                    stopMedia={stopListening}
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
                      xstyle={styles.rating}
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
