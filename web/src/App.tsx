import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { HStack } from "@astryxdesign/core/HStack";
import { Theme } from "@astryxdesign/core/theme";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import * as stylex from "@stylexjs/stylex";

import { ApiError, NotFoundError } from "./api/lessons";
import { createSyncScheduler, type SyncScheduler } from "./lib/syncScheduler";
import { setSyncTrigger } from "./lib/syncEvents";
import { useAuth, type AuthState } from "./hooks/auth";
import { useLesson, useLessons } from "./hooks/lessons";
import { useProgress } from "./hooks/progress";
import { useVocabDeck } from "./hooks/vocab";
import { diffWords, normalize, type WordDiff } from "./lib/dictation";
import { capNewCards, cardId, isCardWord, Rating, State, type Grade, type NewCard, type VocabCard } from "./lib/vocab";
import { speak, stopSpeaking } from "./lib/speech";
import { lookupWord, type Definition } from "./lib/dictionary";
import { useRecorder } from "./hooks/useRecorder";
import { backupFileName, exportData, importData } from "./lib/backup";
import { exportAll, replaceAll } from "./lib/backupStore";

import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";

const appStyles = stylex.create({
  page: {
    minHeight: "100vh",
    padding: "2rem",
    backgroundColor: "var(--color-background-body)",
    color: "var(--color-text-primary)",
  },
  content: {
    width: "100%",
    maxWidth: "48rem",
    marginInline: "auto",
  },
  header: {
    marginBottom: "2rem",
  },
  lessonButton: {
    width: "100%",
    justifyContent: "space-between",
    textAlign: "start",
  },
  sentence: {
    padding: "1rem",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-surface)",
  },
  error: {
    color: "var(--color-error)",
  },
  sentenceWord: {
    paddingInline: "0.125rem",
  },
  spokenWord: {
    backgroundColor: "var(--color-warning-muted)",
  },
  wordCorrect: {
    color: "var(--color-success)",
  },
  shadowingControls: {
    flexWrap: "wrap",
  },
  modeToggle: {
    alignSelf: "start",
  },
  viewToggle: {
    alignSelf: "start",
  },
  backupFileInput: {
    display: "none",
  },
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
  dictationInput: {
    width: "100%",
    minHeight: "2.25rem",
    padding: "0.5rem 0.75rem",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-surface)",
    color: "var(--color-text-primary)",
    font: "inherit",
  },
  accountControls: {
    flexWrap: "wrap",
  },
  accountInput: {
    width: "14rem",
    maxWidth: "100%",
    minHeight: "2.25rem",
    padding: "0.5rem 0.75rem",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-surface)",
    color: "var(--color-text-primary)",
    font: "inherit",
  },
});

const SPEEDS = ["0.5", "0.75", "1"] as const;

const DAILY_GOALS = ["5", "10", "20"] as const;
type DailyGoal = (typeof DAILY_GOALS)[number];
const DAILY_GOAL_KEY = "road-to-english.dailyGoal";

function readDailyGoal(): DailyGoal {
  const stored = localStorage.getItem(DAILY_GOAL_KEY);
  return DAILY_GOALS.find((goal) => goal === stored) ?? "10";
}

// Reference speech highlights the spoken word of its sentence. Any start or end
// clears the highlight; speak's current-utterance guard drops superseded events.
function playReference(
  text: string,
  targetWpm: number,
  speed: number,
  sentenceId: string,
  setSpokenWord: (spoken: { sentenceId: string; charIndex: number } | null) => void,
  onEnd?: () => void,
): SpeechSynthesisUtterance {
  setSpokenWord(null);
  return speak(text, targetWpm, speed, {
    onWord: (charIndex) => setSpokenWord({ sentenceId, charIndex }),
    onEnd: () => {
      setSpokenWord(null);
      onEnd?.();
    },
  });
}

function SentenceShadowing({
  text,
  targetWpm,
  speed,
  looping,
  setLooping,
  sentenceId,
  setSpokenWord,
  recordPractice,
}: {
  text: string;
  targetWpm: number;
  speed: number;
  looping: boolean;
  setLooping: (looping: boolean) => void;
  sentenceId: string;
  setSpokenWord: (spoken: { sentenceId: string; charIndex: number } | null) => void;
  recordPractice: (options: { newCard: boolean }) => Promise<void>;
}) {
  const recorder = useRecorder();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playBlocked, setPlayBlocked] = useState(false);
  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const recordingSupported =
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof URL.createObjectURL === "function";

  useEffect(() => {
    if (recorder.state === "ready") {
      void recordPractice({ newCard: false });
    }
  }, [recordPractice, recorder.state]);

  useEffect(() => {
    if (!looping) {
      return;
    }
    let latest: SpeechSynthesisUtterance | null = null;
    const repeat = () => {
      latest = playReference(text, targetWpm, speed, sentenceId, setSpokenWord, repeat);
    };
    repeat();
    return () => {
      stopSpeaking(latest);
      setSpokenWord(null);
    };
  }, [looping, speed, targetWpm, text, sentenceId, setSpokenWord]);

  return (
    <VStack gap={1}>
      <HStack gap={1} xstyle={appStyles.shadowingControls}>
        <Button
          label="Listen"
          variant="secondary"
          isDisabled={!speechSupported}
          onClick={() => {
            setLooping(false);
            playReference(text, targetWpm, speed, sentenceId, setSpokenWord);
          }}
        />
        <ToggleButton
          label="Loop"
          isPressed={looping}
          isDisabled={!speechSupported}
          onPressedChange={setLooping}
        />
        <Button
          label={recorder.state === "recording" ? "Stop" : "Record"}
          variant="secondary"
          isDisabled={!recordingSupported || recorder.state === "requesting"}
          isLoading={recorder.state === "requesting"}
          onClick={
            recorder.state === "recording"
              ? recorder.stopRecording
              : recorder.startRecording
          }
        />
        <Button
          label="Compare"
          variant="secondary"
          isDisabled={!speechSupported || !recorder.url}
          onClick={() => {
            setLooping(false);
            setPlayBlocked(false);
            playReference(text, targetWpm, speed, sentenceId, setSpokenWord, () => {
              audioRef.current?.play().catch(() => setPlayBlocked(true));
            });
          }}
        />
      </HStack>
      {!speechSupported && (
        <Text as="p" type="supporting">
          Listen disabled: speech synthesis is not supported in this browser.
        </Text>
      )}
      {!recordingSupported && (
        <Text as="p" type="supporting">
          Recording disabled: microphone recording is not supported in this browser.
        </Text>
      )}
      {recorder.error && (
        <Text as="p" color="primary" xstyle={appStyles.error}>
          {recorder.error}
        </Text>
      )}
      {recorder.url && <audio ref={audioRef} controls src={recorder.url} />}
      {playBlocked && (
        <Text as="p" type="supporting">
          Press play to hear your recording.
        </Text>
      )}
    </VStack>
  );
}

function wordLabel(entry: WordDiff): string {
  switch (entry.kind) {
    case "correct":
      return entry.word;
    case "missed":
      return `${entry.word} (missed)`;
    case "replaced":
      return `${entry.word} (you typed "${entry.typed}")`;
    case "extra":
      return `${entry.typed} (extra)`;
  }
}

function SentenceDictation({
  id,
  text,
  notes,
  targetWpm,
  recordPractice,
}: {
  id: string;
  text: string;
  notes?: string;
  targetWpm: number;
  recordPractice: (options: { newCard: boolean }) => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [diff, setDiff] = useState<WordDiff[] | null>(null);
  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const checkAnswer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDiff(diffWords(typed, text));
    void recordPractice({ newCard: false });
  };

  const tryAgain = () => {
    setTyped("");
    setDiff(null);
  };

  return (
    <VStack gap={1}>
      <Button
        label="Play"
        variant="secondary"
        isDisabled={!speechSupported}
        onClick={() => speak(text, targetWpm, 1)}
      />
      {!speechSupported && (
        <Text as="p" type="supporting">
          Play disabled: speech synthesis is not supported in this browser.
        </Text>
      )}
      <form onSubmit={checkAnswer}>
        <VStack gap={1}>
          <label htmlFor={`dictation-${id}`}>
            <Text as="span" type="supporting">
              What did you hear?
            </Text>
          </label>
          <input
            id={`dictation-${id}`}
            aria-label="Your answer"
            className={stylex.props(appStyles.dictationInput).className}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <Button label="Check" variant="primary" type="submit" />
        </VStack>
      </form>
      {diff !== null && (
        <VStack gap={1}>
          <Text as="p">Reference: {text}</Text>
          <Text as="p">You typed: {typed}</Text>
          <Text as="p">
            {diff.map((entry, index) => (
              <Text
                key={index}
                as="span"
                color="primary"
                xstyle={entry.kind === "correct" ? appStyles.wordCorrect : appStyles.error}
              >
                {index > 0 && " "}
                {wordLabel(entry)}
              </Text>
            ))}
          </Text>
          {notes && <Text as="p" type="supporting">{notes}</Text>}
          <Text as="p" weight="semibold">
            {diff.every((entry) => entry.kind === "correct") ? "Correct" : "Not quite"}
          </Text>
          <Button label="Try again" variant="ghost" onClick={tryAgain} />
        </VStack>
      )}
    </VStack>
  );
}

function ErrorMessage({ error, subject }: { error: Error; subject: string }) {
  const message = error instanceof NotFoundError ? "not found" : error.message;

  return (
    <Text as="p" color="primary" xstyle={appStyles.error}>
      Unable to load {subject}: {message}
    </Text>
  );
}

const passwordPolicyMessage =
  "Password must be at least 8 characters (and at most 72 bytes).";

function AccountError({ error, isSignUp }: { error: Error; isSignUp: boolean }) {
  let message = "Unable to complete account request. Please try again.";
  if (error instanceof ApiError) {
    if (error.status === 409) {
      message = "This email is already registered.";
    } else if (error.status === 401) {
      message = "Invalid email or password.";
    } else if (error.status === 400 && isSignUp) {
      message = passwordPolicyMessage;
    }
  } else if (error.message) {
    message = `${error.message}. You can continue using the app.`;
  }

  return (
    <Text as="p" color="primary" xstyle={appStyles.error}>
      {message}
    </Text>
  );
}

function AccountArea({ auth }: { auth: AuthState }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lastAction, setLastAction] = useState<"signIn" | "signUp" | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async (action: AuthState["signIn"], isSignUp: boolean) => {
    setLastAction(isSignUp ? "signUp" : "signIn");
    setLocalError(null);
    if (isSignUp && (Array.from(password).length < 8 || new TextEncoder().encode(password).byteLength > 72)) {
      setLocalError(passwordPolicyMessage);
      return;
    }
    try {
      await action(email, password);
      setPassword("");
    } catch {
      // The hook exposes the error for the inline account message.
    }
  };

  if (auth.user) {
    return (
      <VStack gap={1}>
        <HStack gap={1} align="center" xstyle={appStyles.accountControls}>
          <Text type="supporting">{auth.user.email}</Text>
          <Button
            label="Sign out"
            variant="secondary"
            onClick={() => void auth.signOut().catch(() => undefined)}
          />
        </HStack>
        {auth.error && <AccountError error={auth.error} isSignUp={false} />}
      </VStack>
    );
  }

  return (
    <VStack gap={1}>
      <form onSubmit={(event) => {
        event.preventDefault();
        void submit(auth.signIn, false);
      }}>
        <HStack gap={1} align="center" xstyle={appStyles.accountControls}>
          <input
            aria-label="Email"
            className={stylex.props(appStyles.accountInput).className}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            required
          />
          <input
            aria-label="Password"
            className={stylex.props(appStyles.accountInput).className}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            required
          />
          <Button label="Sign in" variant="secondary" type="submit" />
          <Button
            label="Sign up"
            variant="primary"
            type="button"
            onClick={() => void submit(auth.signUp, true)}
          />
        </HStack>
      </form>
      {localError && (
        <Text as="p" color="primary" xstyle={appStyles.error}>
          {localError}
        </Text>
      )}
      {auth.error && <AccountError error={auth.error} isSignUp={lastAction === "signUp"} />}
    </VStack>
  );
}

function LessonList({
  onSelect,
  completedLessons,
}: {
  onSelect: (id: string) => void;
  completedLessons: Set<string>;
}) {
  const { data, loading, error } = useLessons();

  if (loading) {
    return <Text as="p">Loading lessons...</Text>;
  }

  if (error) {
    return <ErrorMessage error={error} subject="lessons" />;
  }

  if (!data || data.length === 0) {
    return <Text as="p">No lessons available.</Text>;
  }

  return (
    <VStack as="ul" gap={2} padding={0}>
      {data.map((lesson) => (
        <li key={lesson.id}>
          <Button
            label={lesson.title}
            variant="secondary"
            xstyle={appStyles.lessonButton}
            onClick={() => onSelect(lesson.id)}
          >
            <HStack justify="between" align="center" width="100%">
              <VStack gap={0.5} align="start">
                <Text weight="semibold">{lesson.title}</Text>
                <Text type="supporting">
                  {lesson.level} · {lesson.sentenceCount} sentences
                </Text>
              </VStack>
              <HStack gap={1} align="center">
                <Badge label={`${lesson.targetWpm} WPM`} variant="info" />
                {completedLessons.has(lesson.id) && (
                  <Badge label="Completed" variant="success" />
                )}
              </HStack>
            </HStack>
          </Button>
        </li>
      ))}
    </VStack>
  );
}

function SaveToReview({
  card,
  label,
  saved,
  addCard,
}: {
  card: NewCard;
  label: string;
  saved: boolean;
  addCard: (input: NewCard) => Promise<void>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);

  const save = async () => {
    if (saved || isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    try {
      await addCard(card);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <Button
      label={saved ? "Saved" : label}
      variant="ghost"
      isDisabled={saved || isSaving}
      onClick={() => void save()}
    />
  );
}

function sentenceCard(
  lessonId: string,
  sentence: { id: string; text: string; notes?: string },
): NewCard {
  return {
    front: sentence.text,
    back: sentence.notes ?? "",
    source: { lessonId, sentenceId: sentence.id, word: "" },
  };
}

// Splits on letter/digit runs (apostrophes kept, so "What's" is one word) and
// renders each run whose normalize() is a single token as a button; everything
// else stays plain text, so the sentence text reads exactly as authored. The
// word whose character range holds spokenChar is marked as currently spoken.
function SentenceWords({
  text,
  selected,
  spokenChar,
  onSelect,
}: {
  text: string;
  selected: string | null;
  spokenChar: number | null;
  onSelect: (text: string) => void;
}) {
  let start = 0;
  return (
    <Text as="p">
      {text.split(/([A-Za-z0-9'’]+)/).map((part, index) => {
        const partStart = start;
        start += part.length;
        if (!isCardWord(normalize(part))) {
          return part;
        }
        const spoken =
          spokenChar !== null && spokenChar >= partStart && spokenChar < start;
        return (
          <Button
            key={index}
            label={part}
            size="sm"
            variant={part === selected ? "secondary" : "ghost"}
            aria-current={spoken ? "true" : undefined}
            xstyle={[appStyles.sentenceWord, spoken && appStyles.spokenWord]}
            onClick={() => onSelect(part)}
          />
        );
      })}
    </Text>
  );
}

function WordPanel({
  text,
  card,
  savedCardIds,
  addCard,
  hear,
}: {
  text: string;
  card: NewCard;
  savedCardIds: Set<string>;
  addCard: (input: NewCard) => Promise<void>;
  hear: () => void;
}) {
  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const word = card.source.word;
  // The panel is keyed by word, so a late response for a previous word lands on an unmounted panel.
  const [lookup, setLookup] = useState<"idle" | "pending" | Definition | null>("idle");

  const define = async () => {
    setLookup("pending");
    setLookup(await lookupWord(word));
  };

  return (
    <VStack gap={1}>
      <HStack gap={1} align="center" xstyle={appStyles.shadowingControls}>
        <Text weight="semibold">{text}</Text>
        <Button
          label="Hear word"
          variant="secondary"
          isDisabled={!speechSupported}
          onClick={hear}
        />
        <SaveToReview
          key={card.source.word}
          card={card}
          label="Save word"
          saved={savedCardIds.has(cardId(card.source))}
          addCard={addCard}
        />
        <Button
          label="Define"
          variant="secondary"
          isDisabled={lookup === "pending"}
          onClick={() => void define()}
        />
        <Link
          href={"https://youglish.com/pronounce/" + encodeURIComponent(word) + "/english"}
          target="_blank"
          rel="noopener noreferrer"
        >
          Hear it on YouGlish
        </Link>
      </HStack>
      {lookup === "pending" && <Text as="p" type="supporting">Looking up…</Text>}
      {lookup === null && <Text as="p" type="supporting">No definition</Text>}
      {typeof lookup === "object" && lookup !== null && (
        <Text as="p">
          {lookup.phonetic && `${lookup.phonetic} · `}
          <Text weight="semibold">{lookup.partOfSpeech}</Text> — {lookup.definition}
        </Text>
      )}
    </VStack>
  );
}

function ReviewDeck({
  due,
  loading,
  review,
  recordPractice,
}: {
  due: VocabCard[];
  loading: boolean;
  review: (card: VocabCard, rating: Grade) => Promise<void>;
  recordPractice: (options: { newCard: boolean }) => Promise<void>;
}) {
  const [showAnswer, setShowAnswer] = useState(false);
  const [isRating, setIsRating] = useState(false);
  const isRatingRef = useRef(false);
  const card = due[0];

  useEffect(() => {
    setShowAnswer(false);
  }, [card?.id]);

  if (loading) {
    return <Text as="p">Loading review deck...</Text>;
  }

  if (!card) {
    return (
      <Text as="p">
        Nothing due — save sentences from a lesson to build your deck.
      </Text>
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
    try {
      await review(card, rating);
      await recordPractice({ newCard });
    } finally {
      isRatingRef.current = false;
      setIsRating(false);
    }
  };

  return (
    <VStack gap={3}>
      <Card padding={3} xstyle={appStyles.reviewCard}>
        <VStack gap={2}>
          <Text as="p" weight="semibold">{card.front}</Text>
          {showAnswer && (
            <Text as="p" xstyle={appStyles.answer}>{card.back}</Text>
          )}
          {!showAnswer ? (
            <Button
              label="Show answer"
              variant="primary"
              onClick={() => setShowAnswer(true)}
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
        </VStack>
      </Card>
    </VStack>
  );
}

function LessonDetail({
  id,
  onBack,
  savedCardIds,
  addCard,
  recordPractice,
  completed,
  markLessonComplete,
}: {
  id: string;
  onBack: () => void;
  savedCardIds: Set<string>;
  addCard: (input: NewCard) => Promise<void>;
  recordPractice: (options: { newCard: boolean }) => Promise<void>;
  completed: boolean;
  markLessonComplete: (lessonId: string) => Promise<void>;
}) {
  const { data, loading, error } = useLesson(id);
  const [mode, setMode] = useState<"shadow" | "dictation">("shadow");
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>("1");
  const [loopingSentenceId, setLoopingSentenceId] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(true);
  const [showVietnamese, setShowVietnamese] = useState(false);
  const [selectedWord, setSelectedWord] = useState<{
    sentenceId: string;
    text: string;
  } | null>(null);
  const [spokenWord, setSpokenWord] = useState<{
    sentenceId: string;
    charIndex: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        stopSpeaking();
      }
    };
  }, []);

  if (loading) {
    return <Text as="p">Loading lesson...</Text>;
  }

  if (error) {
    return (
      <VStack gap={3}>
        <ErrorMessage error={error} subject="lesson" />
        <Button label="Back to lessons" variant="ghost" onClick={onBack} />
      </VStack>
    );
  }

  if (!data) {
    return <Text as="p">Lesson unavailable.</Text>;
  }

  return (
    <VStack gap={4}>
      <HStack justify="between" align="center">
        <Button label="Back to lessons" variant="ghost" onClick={onBack} />
        <HStack gap={1} align="center">
          <Badge label={`${data.targetWpm} WPM`} variant="info" />
          {completed && <Badge label="Completed" variant="success" />}
        </HStack>
      </HStack>
      <VStack gap={1}>
        <Heading level={2}>{data.title}</Heading>
        <Text type="supporting">Level {data.level}</Text>
      </VStack>
      <Button
        label={completed ? "Completed" : "Mark complete"}
        variant="secondary"
        isDisabled={completed}
        onClick={() => void markLessonComplete(data.id)}
      />
      <ToggleButtonGroup
        label="Lesson mode"
        value={mode}
        onChange={(nextMode) => {
          if (nextMode) {
            setMode(nextMode as "shadow" | "dictation");
            setLoopingSentenceId(null);
            setSpokenWord(null);
          }
        }}
        xstyle={appStyles.modeToggle}
      >
        <ToggleButton value="shadow" label="Shadow" />
        <ToggleButton value="dictation" label="Dictation" />
      </ToggleButtonGroup>
      {mode === "shadow" && (
        <HStack gap={1} align="center" xstyle={appStyles.shadowingControls}>
          <ToggleButtonGroup
            label="Playback speed"
            value={speed}
            onChange={(nextSpeed) => {
              if (nextSpeed) {
                setSpeed(nextSpeed as (typeof SPEEDS)[number]);
              }
            }}
          >
            {SPEEDS.map((value) => (
              <ToggleButton key={value} value={value} label={`${value}x`} />
            ))}
          </ToggleButtonGroup>
          <Button
            label={showTranscript ? "Hide transcript" : "Show transcript"}
            variant="ghost"
            onClick={() => setShowTranscript((shown) => !shown)}
          />
          <Button
            label={showVietnamese ? "Hide Vietnamese" : "Show Vietnamese"}
            variant="ghost"
            onClick={() => setShowVietnamese((shown) => !shown)}
          />
        </HStack>
      )}
      <VStack as="ol" gap={2} padding={0}>
        {data.sentences.map((sentence) => (
          <li key={sentence.id}>
            <Card padding={3} xstyle={appStyles.sentence}>
              {mode === "shadow" ? (
                <VStack gap={1}>
                  {showTranscript && (
                    <SentenceWords
                      text={sentence.text}
                      selected={
                        selectedWord?.sentenceId === sentence.id
                          ? selectedWord.text
                          : null
                      }
                      spokenChar={
                        spokenWord?.sentenceId === sentence.id
                          ? spokenWord.charIndex
                          : null
                      }
                      onSelect={(text) =>
                        setSelectedWord({ sentenceId: sentence.id, text })
                      }
                    />
                  )}
                  {showTranscript && sentence.notes && (
                    <Text as="p" type="supporting">
                      {sentence.notes}
                    </Text>
                  )}
                  {showVietnamese && (
                    <Text as="p" type="supporting">
                      {sentence.vi}
                    </Text>
                  )}
                  {showTranscript && selectedWord?.sentenceId === sentence.id && (
                    <WordPanel
                      key={normalize(selectedWord.text)}
                      text={selectedWord.text}
                      card={{
                        front: selectedWord.text,
                        back: `${sentence.text} — ${sentence.vi}`,
                        source: {
                          lessonId: data.id,
                          sentenceId: sentence.id,
                          word: normalize(selectedWord.text),
                        },
                      }}
                      savedCardIds={savedCardIds}
                      addCard={addCard}
                      hear={() => {
                        setLoopingSentenceId(null);
                        setSpokenWord(null);
                        speak(selectedWord.text, data.targetWpm, Number(speed));
                      }}
                    />
                  )}
                  <SentenceShadowing
                    text={sentence.text}
                    targetWpm={data.targetWpm}
                    speed={Number(speed)}
                    looping={loopingSentenceId === sentence.id}
                    setLooping={(looping) =>
                      setLoopingSentenceId(looping ? sentence.id : null)
                    }
                    sentenceId={sentence.id}
                    setSpokenWord={setSpokenWord}
                    recordPractice={recordPractice}
                  />
                  <SaveToReview
                    card={sentenceCard(data.id, sentence)}
                    label="Save to review"
                    saved={savedCardIds.has(cardId(sentenceCard(data.id, sentence).source))}
                    addCard={addCard}
                  />
                </VStack>
              ) : (
                <VStack gap={1}>
                  <SentenceDictation
                    id={sentence.id}
                    text={sentence.text}
                    notes={sentence.notes}
                    targetWpm={data.targetWpm}
                    recordPractice={recordPractice}
                  />
                  <SaveToReview
                    card={sentenceCard(data.id, sentence)}
                    label="Save to review"
                    saved={savedCardIds.has(cardId(sentenceCard(data.id, sentence).source))}
                    addCard={addCard}
                  />
                </VStack>
              )}
            </Card>
          </li>
        ))}
      </VStack>
    </VStack>
  );
}

export function App() {
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [view, setView] = useState<"library" | "review">("library");
  const [backupError, setBackupError] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const deck = useVocabDeck();
  const progress = useProgress();
  const reviewDeck = capNewCards(deck.due, progress.newCardsToday);
  const [dailyGoal, setDailyGoal] = useState(readDailyGoal);
  const goalMet = progress.actionsToday >= Number(dailyGoal);
  const auth = useAuth();
  const syncRef = useRef<SyncScheduler | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    setSyncTrigger(() => syncRef.current?.trigger());
    return () => setSyncTrigger(undefined);
  }, []);

  useEffect(() => {
    syncRef.current?.stop();
    syncRef.current = null;
    setSyncMessage(null);
    if (!auth.user) {
      return;
    }
    const scheduler = createSyncScheduler(
      auth.user.id,
      async () => {
        await Promise.all([deck.reload(), progress.reload()]);
      },
      () => setSyncMessage("This device's data belongs to another account, so sync is off. Sign in with that account to sync."),
    );
    syncRef.current = scheduler;
    scheduler.trigger();
    return () => {
      scheduler.stop();
      if (syncRef.current === scheduler) {
        syncRef.current = null;
      }
    };
  }, [auth.user, deck.reload, progress.reload]);

  const exportBackup = async () => {
    try {
      const text = exportData(await exportAll(), new Date());
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = backupFileName(new Date());
      link.click();
      link.remove();
      URL.revokeObjectURL?.(url);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : "Unable to export backup.");
    }
  };

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }

    try {
      const data = importData(await file.text());
      if (!window.confirm("Importing this backup will replace all local data. Continue?")) {
        return;
      }
      await replaceAll(data);
      await Promise.all([deck.reload(), progress.reload()]);
      setBackupError(null);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : "Unable to import backup.");
    }
  };

  return (
    <Theme theme={neutralTheme}>
      <main className={stylex.props(appStyles.page).className}>
        <div className={stylex.props(appStyles.content).className}>
          <VStack gap={4}>
            <VStack gap={1} xstyle={appStyles.header}>
              <Heading level={1}>
                {view === "library" ? "Lesson library" : "Review deck"}
              </Heading>
              <Text type="large">
                {view === "library"
                  ? "Choose a lesson to practise reading and speaking."
                  : "Review saved sentences with spaced repetition."}
              </Text>
              <HStack gap={1} align="center">
                <Badge
                  label={`${progress.streak} day${progress.streak === 1 ? "" : "s"} streak`}
                  variant="info"
                />
                <Badge label={`${progress.xp} XP`} variant="info" />
                <Badge label={`Freezes ${progress.freezes}/2`} variant="info" />
                <Badge
                  label={progress.practicedToday ? "Practiced today" : "Not practiced today"}
                  variant={progress.practicedToday ? "success" : "info"}
                />
                <Badge
                  label={`Goal ${progress.actionsToday}/${dailyGoal}`}
                  variant={goalMet ? "success" : "info"}
                />
                <ToggleButtonGroup
                  label="Daily goal"
                  value={dailyGoal}
                  onChange={(nextGoal) => {
                    if (nextGoal) {
                      localStorage.setItem(DAILY_GOAL_KEY, nextGoal);
                      setDailyGoal(nextGoal as DailyGoal);
                    }
                  }}
                >
                  {DAILY_GOALS.map((value) => (
                    <ToggleButton key={value} value={value} label={value} />
                  ))}
                </ToggleButtonGroup>
              </HStack>
              <HStack gap={1} align="center">
                <Button label="Export" variant="secondary" onClick={() => void exportBackup()} />
                <Button
                  label="Import"
                  variant="secondary"
                  onClick={() => importInput.current?.click()}
                />
                <input
                  ref={importInput}
                  className={stylex.props(appStyles.backupFileInput).className}
                  type="file"
                  accept="application/json"
                  aria-label="Import backup file"
                  onChange={(event) => void importBackup(event)}
                />
              </HStack>
              {backupError && (
                <Text as="p" color="primary" xstyle={appStyles.error}>
                  Backup error: {backupError}
                </Text>
              )}
              {syncMessage && (
                <Text as="p" color="primary" xstyle={appStyles.error}>
                  {syncMessage}
                </Text>
              )}
              <AccountArea auth={auth} />
            </VStack>
            <ToggleButtonGroup
              label="App view"
              value={view}
              onChange={(nextView) => {
                if (nextView) {
                  setView(nextView as "library" | "review");
                }
              }}
              xstyle={appStyles.viewToggle}
            >
              <ToggleButton value="library" label="Library" />
              <ToggleButton value="review" label="Review" />
            </ToggleButtonGroup>
            {view === "review" ? (
              <VStack gap={2}>
                <Badge label={`${reviewDeck.length} due`} variant="info" />
                <ReviewDeck
                  due={reviewDeck}
                  loading={deck.loading}
                  review={deck.review}
                  recordPractice={progress.recordPractice}
                />
              </VStack>
            ) : selectedLessonId === null ? (
              <LessonList
                onSelect={setSelectedLessonId}
                completedLessons={progress.completedLessons}
              />
            ) : (
              <LessonDetail
                id={selectedLessonId}
                onBack={() => setSelectedLessonId(null)}
                savedCardIds={deck.savedCardIds}
                addCard={deck.addCard}
                recordPractice={progress.recordPractice}
                completed={progress.completedLessons.has(selectedLessonId)}
                markLessonComplete={progress.markLessonComplete}
              />
            )}
          </VStack>
        </div>
      </main>
    </Theme>
  );
}
