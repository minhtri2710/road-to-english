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
import { HStack } from "@astryxdesign/core/HStack";
import { Theme } from "@astryxdesign/core/theme";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import * as stylex from "@stylexjs/stylex";

import { ApiError, NotFoundError } from "./api/lessons";
import { useAuth, type AuthState } from "./hooks/auth";
import { useLesson, useLessons } from "./hooks/lessons";
import { useProgress } from "./hooks/progress";
import { useVocabDeck } from "./hooks/vocab";
import { matchesReference } from "./lib/dictation";
import { Rating, type Grade, type VocabCard } from "./lib/vocab";
import { speak } from "./lib/speech";
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

function SentenceShadowing({
  text,
  targetWpm,
  recordPractice,
}: {
  text: string;
  targetWpm: number;
  recordPractice: () => Promise<void>;
}) {
  const recorder = useRecorder();
  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const recordingSupported =
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof URL.createObjectURL === "function";

  useEffect(() => {
    if (recorder.state === "ready") {
      void recordPractice();
    }
  }, [recordPractice, recorder.state]);

  return (
    <VStack gap={1}>
      <HStack gap={1} xstyle={appStyles.shadowingControls}>
        <Button
          label="Listen"
          variant="secondary"
          isDisabled={!speechSupported}
          onClick={() => speak(text, targetWpm)}
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
      {recorder.url && <audio controls src={recorder.url} />}
    </VStack>
  );
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
  recordPractice: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const checkAnswer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCorrect(matchesReference(typed, text));
    void recordPractice();
  };

  const tryAgain = () => {
    setTyped("");
    setIsCorrect(null);
  };

  return (
    <VStack gap={1}>
      <Button
        label="Play"
        variant="secondary"
        isDisabled={!speechSupported}
        onClick={() => speak(text, targetWpm)}
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
      {isCorrect !== null && (
        <VStack gap={1}>
          <Text as="p">Reference: {text}</Text>
          <Text as="p">You typed: {typed}</Text>
          {notes && <Text as="p" type="supporting">{notes}</Text>}
          <Text as="p" weight="semibold">
            {isCorrect ? "Correct" : "Not quite"}
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

function AccountError({ error }: { error: Error }) {
  let message = "Unable to complete account request. Please try again.";
  if (error instanceof ApiError) {
    if (error.status === 409) {
      message = "This email is already registered.";
    } else if (error.status === 401) {
      message = "Invalid email or password.";
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

  const submit = async (action: AuthState["signIn"]) => {
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
        {auth.error && <AccountError error={auth.error} />}
      </VStack>
    );
  }

  return (
    <VStack gap={1}>
      <form onSubmit={(event) => {
        event.preventDefault();
        void submit(auth.signIn);
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
            onClick={() => void submit(auth.signUp)}
          />
        </HStack>
      </form>
      {auth.error && <AccountError error={auth.error} />}
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
  lessonId,
  sentence,
  saved,
  addCard,
}: {
  lessonId: string;
  sentence: { id: string; text: string; notes?: string };
  saved: boolean;
  addCard: (input: {
    front: string;
    back: string;
    source: { lessonId: string; sentenceId: string };
  }) => Promise<void>;
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
      await addCard({
        front: sentence.text,
        back: sentence.notes ?? "",
        source: { lessonId, sentenceId: sentence.id },
      });
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <Button
      label={saved ? "Saved" : "Save to review"}
      variant="ghost"
      isDisabled={saved || isSaving}
      onClick={() => void save()}
    />
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
  recordPractice: () => Promise<void>;
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
    try {
      await review(card, rating);
      await recordPractice();
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
  savedSentenceIds,
  addCard,
  recordPractice,
  completed,
  markLessonComplete,
}: {
  id: string;
  onBack: () => void;
  savedSentenceIds: Set<string>;
  addCard: (input: {
    front: string;
    back: string;
    source: { lessonId: string; sentenceId: string };
  }) => Promise<void>;
  recordPractice: () => Promise<void>;
  completed: boolean;
  markLessonComplete: (lessonId: string) => Promise<void>;
}) {
  const { data, loading, error } = useLesson(id);
  const [mode, setMode] = useState<"shadow" | "dictation">("shadow");

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
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
          }
        }}
        xstyle={appStyles.modeToggle}
      >
        <ToggleButton value="shadow" label="Shadow" />
        <ToggleButton value="dictation" label="Dictation" />
      </ToggleButtonGroup>
      <VStack as="ol" gap={2} padding={0}>
        {data.sentences.map((sentence) => (
          <li key={sentence.id}>
            <Card padding={3} xstyle={appStyles.sentence}>
              {mode === "shadow" ? (
                <VStack gap={1}>
                  <Text as="p">{sentence.text}</Text>
                  {sentence.notes && (
                    <Text as="p" type="supporting">
                      {sentence.notes}
                    </Text>
                  )}
                  <SentenceShadowing
                    text={sentence.text}
                    targetWpm={data.targetWpm}
                    recordPractice={recordPractice}
                  />
                  <SaveToReview
                    lessonId={data.id}
                    sentence={sentence}
                    saved={savedSentenceIds.has(sentence.id)}
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
                    lessonId={data.id}
                    sentence={sentence}
                    saved={savedSentenceIds.has(sentence.id)}
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
  const auth = useAuth();

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
                <Badge
                  label={progress.practicedToday ? "Practiced today" : "Not practiced today"}
                  variant={progress.practicedToday ? "success" : "info"}
                />
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
              <ReviewDeck
                due={deck.due}
                loading={deck.loading}
                review={deck.review}
                recordPractice={progress.recordPractice}
              />
            ) : selectedLessonId === null ? (
              <LessonList
                onSelect={setSelectedLessonId}
                completedLessons={progress.completedLessons}
              />
            ) : (
              <LessonDetail
                id={selectedLessonId}
                onBack={() => setSelectedLessonId(null)}
                savedSentenceIds={deck.savedSentenceIds}
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
