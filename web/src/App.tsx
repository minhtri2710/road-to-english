import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { HStack } from "@astryxdesign/core/HStack";
import { Theme } from "@astryxdesign/core/theme";
import { useToast } from "@astryxdesign/core/Toast";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import * as stylex from "@stylexjs/stylex";

import { ApiError, NotFoundError, type Lesson, type Level } from "./api/lessons";
import { createSyncScheduler, type SyncScheduler, type SyncStatus } from "./lib/syncScheduler";
import { setSyncTrigger } from "./lib/syncEvents";
import { useAuth, type AuthState } from "./hooks/auth";
import { useLesson, useLessons } from "./hooks/lessons";
import { useProgress } from "./hooks/progress";
import { useVocabDeck } from "./hooks/vocab";
import { blankFor, diffWords, normalize, splitWords, type WordDiff } from "./lib/dictation";
import { capNewCards, cardId, isCardWord, NEW_CARDS_PER_DAY, Rating, State, type Grade, type NewCard, type VocabCard } from "./lib/vocab";
import { speak, stopSpeaking } from "./lib/speech";
import { abortActiveRecognition, recognitionSupported, recognizeOnce } from "./lib/recognition";
import { lookupWord, type Definition } from "./lib/dictionary";
import { stopActiveRecording, useRecorder } from "./hooks/useRecorder";
import { useYouTubePlayer } from "./hooks/useYouTubePlayer";
import { backupFileName, exportData, importData } from "./lib/backup";
import { exportBackupData, replaceAll } from "./lib/backupStore";
import { cardsCsv, cardsCsvFileName } from "./lib/csv";
import { getAllCards } from "./lib/vocabStore";
import {
  createUserLesson,
  deleteUserLesson,
  listUserLessons,
  putUserLesson,
  USER_LEVELS,
  USER_WPMS,
} from "./lib/userLessons";

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
    // The row grows to its two-line content; badges wrap below the title when space runs out.
    height: "auto",
    paddingBlock: "0.5rem",
    whiteSpace: "normal",
  },
  lessonRowContent: {
    flexWrap: "wrap",
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
  video: {
    width: "100%",
    aspectRatio: "16 / 9",
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
  importTextArea: {
    width: "100%",
    minHeight: "8rem",
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
  tapTarget: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "1.5rem",
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

const PRONUNCIATION_CHECK_KEY = "road-to-english.pronunciationCheck";

function readPronunciationCheck(): boolean {
  return localStorage.getItem(PRONUNCIATION_CHECK_KEY) === "on";
}

// Reference speech highlights the spoken word of its sentence. Any start, end or
// error clears the highlight; speak's current-utterance guard drops superseded events.
function playReference(
  text: string,
  targetWpm: number,
  speed: number,
  sentenceId: string,
  setSpokenWord: (spoken: { sentenceId: string; charIndex: number } | null) => void,
  handlers: { onEnd?: () => void; onError?: () => void } = {},
): SpeechSynthesisUtterance {
  setSpokenWord(null);
  return speak(text, targetWpm, speed, {
    onWord: (charIndex) => setSpokenWord({ sentenceId, charIndex }),
    onEnd: () => {
      setSpokenWord(null);
      handlers.onEnd?.();
    },
    onError: () => {
      setSpokenWord(null);
      handlers.onError?.();
    },
  });
}

type PracticeMode = "recording" | "check" | "dictation" | "blank";

// Every mounted recording player, across all sentences, so starting any medium can pause them.
const recordingAudios = new Set<HTMLAudioElement>();

function SentenceShadowing({
  text,
  targetWpm,
  speed,
  looping,
  setLooping,
  sentenceId,
  setSpokenWord,
  practice,
  pronunciationCheck,
  stopMedia,
}: {
  text: string;
  targetWpm: number;
  speed: number;
  looping: boolean;
  setLooping: (looping: boolean) => void;
  sentenceId: string;
  setSpokenWord: (spoken: { sentenceId: string; charIndex: number } | null) => void;
  practice: (mode: PracticeMode) => void;
  pronunciationCheck: boolean;
  stopMedia: (options?: { keepAudio?: HTMLAudioElement }) => void;
}) {
  const recorder = useRecorder();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playBlocked, setPlayBlocked] = useState(false);
  const [speechFailed, setSpeechFailed] = useState(false);
  const recognitionRef = useRef<ReturnType<typeof recognizeOnce> | null>(null);
  const checkButtonRef = useRef<HTMLButtonElement>(null);
  const [check, setCheck] = useState<
    | { status: "idle" }
    | { status: "listening" }
    | { status: "heard"; transcript: string }
    | { status: "failed"; message: string }
  >({ status: "idle" });
  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const listening = check.status === "listening";
  const recordingSupported =
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof URL.createObjectURL === "function";

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    recordingAudios.add(audio);
    return () => {
      recordingAudios.delete(audio);
      audio.pause();
    };
  }, [recorder.url]);

  useEffect(() => {
    if (recorder.state === "ready") {
      practice("recording");
    }
  }, [practice, recorder.state]);

  useEffect(() => {
    if (!looping) {
      return;
    }
    let latest: SpeechSynthesisUtterance | null = null;
    const repeat = () => {
      latest = playReference(text, targetWpm, speed, sentenceId, setSpokenWord, {
        onEnd: repeat,
        onError: () => {
          setLooping(false);
          setSpeechFailed(true);
        },
      });
    };
    repeat();
    return () => {
      stopSpeaking(latest);
      setSpokenWord(null);
    };
  }, [looping, speed, targetWpm, text, sentenceId, setSpokenWord]);

  useEffect(() => {
    if (!pronunciationCheck) {
      return;
    }
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      setCheck({ status: "idle" });
    };
  }, [pronunciationCheck]);

  const checkPronunciation = () => {
    stopMedia();
    setCheck({ status: "listening" });
    const recognition = recognizeOnce();
    recognitionRef.current = recognition;
    recognition.result.then(
      (transcript) => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setCheck({ status: "heard", transcript });
        if (transcript.trim()) {
          practice("check");
        }
      },
      (error: Error) => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setCheck(
          error.name === "AbortError"
            ? { status: "idle" }
            : { status: "failed", message: error.message },
        );
      },
    );
  };

  // Try again removes itself, so focus goes back to the check it repeats.
  const tryAgain = () => {
    setCheck({ status: "idle" });
    checkButtonRef.current?.focus();
  };

  return (
    <VStack gap={1}>
      <HStack gap={1} xstyle={appStyles.shadowingControls}>
        <Button
          label="Listen"
          variant="secondary"
          isDisabled={!speechSupported || listening}
          onClick={() => {
            stopMedia();
            setSpeechFailed(false);
            playReference(text, targetWpm, speed, sentenceId, setSpokenWord, {
              onError: () => setSpeechFailed(true),
            });
          }}
        />
        <ToggleButton
          label="Loop"
          isPressed={looping}
          isDisabled={!speechSupported || listening}
          onPressedChange={(pressed) => {
            stopMedia();
            if (pressed) {
              setSpeechFailed(false);
              setLooping(true);
            }
          }}
        />
        <Button
          label={recorder.state === "recording" ? "Stop" : "Record"}
          variant="secondary"
          isDisabled={!recordingSupported || recorder.state === "requesting"}
          isLoading={recorder.state === "requesting"}
          // A tooltip makes Astryx use aria-disabled, so the pressed button keeps keyboard focus.
          tooltip={recorder.state === "requesting" ? "Starting the microphone…" : undefined}
          onClick={() => {
            if (recorder.state === "recording") {
              recorder.stopRecording();
            } else {
              stopMedia();
              void recorder.startRecording();
            }
          }}
        />
        <Button
          label="Compare"
          variant="secondary"
          isDisabled={!speechSupported || listening || !recorder.url}
          onClick={() => {
            stopMedia();
            setPlayBlocked(false);
            // A reference that fails to speak still leads to the recording.
            const playRecording = () => {
              audioRef.current?.play().catch(() => setPlayBlocked(true));
            };
            playReference(text, targetWpm, speed, sentenceId, setSpokenWord, {
              onEnd: playRecording,
              onError: playRecording,
            });
          }}
        />
        {pronunciationCheck && (
          <Button
            ref={checkButtonRef}
            label={listening ? "Listening…" : "Check pronunciation"}
            variant="secondary"
            isDisabled={listening}
            tooltip={listening ? "Say the sentence" : undefined}
            onClick={checkPronunciation}
          />
        )}
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
      {recorder.url && (
        <audio
          ref={audioRef}
          controls
          src={recorder.url}
          onPlay={(event) => stopMedia({ keepAudio: event.currentTarget })}
        />
      )}
      <Status>
        {speechFailed && (
          <Text as="p" type="supporting">
            Couldn't play the sentence. Check your browser's speech settings.
          </Text>
        )}
        {recorder.error && (
          <Text as="p" color="primary" xstyle={appStyles.error}>
            {recorder.error}
          </Text>
        )}
        {playBlocked && (
          <Text as="p" type="supporting">
            Press play to hear your recording.
          </Text>
        )}
        {check.status === "heard" && (
          <WordDiffResult text={text} answer={check.transcript} verb="said" />
        )}
        {check.status === "failed" && (
          <Text as="p" color="primary" xstyle={appStyles.error}>
            {check.message}
          </Text>
        )}
      </Status>
      {(check.status === "heard" || check.status === "failed") && (
        <Button label="Try again" variant="ghost" onClick={tryAgain} />
      )}
    </VStack>
  );
}

// A polite region mounted before its content, so screen readers announce each result once.
function Status({ children }: { children: ReactNode }) {
  return (
    <VStack gap={1} role="status">
      {children}
    </VStack>
  );
}

function wordLabel(entry: WordDiff, verb: "typed" | "said"): string {
  switch (entry.kind) {
    case "correct":
      return entry.word;
    case "missed":
      return `${entry.word} (missed)`;
    case "replaced":
      return `${entry.word} (you ${verb} "${entry.typed}")`;
    case "extra":
      return `${entry.typed} (extra)`;
  }
}

function WordDiffResult({
  text,
  answer,
  verb,
  notes,
}: {
  text: string;
  answer: string;
  verb: "typed" | "said";
  notes?: string;
}) {
  const diff = diffWords(answer, text);
  return (
    <VStack gap={1}>
      <Text as="p">Reference: {text}</Text>
      <Text as="p">
        You {verb}: {answer}
      </Text>
      <Text as="p">
        {diff.map((entry, index) => (
          <Text
            key={index}
            as="span"
            color="primary"
            xstyle={entry.kind === "correct" ? appStyles.wordCorrect : appStyles.error}
          >
            {index > 0 && " "}
            {wordLabel(entry, verb)}
          </Text>
        ))}
      </Text>
      {notes && <Text as="p" type="supporting">{notes}</Text>}
      <Text as="p" weight="semibold">
        {diff.every((entry) => entry.kind === "correct") ? "Correct" : "Not quite"}
      </Text>
    </VStack>
  );
}

function SentenceDictation({
  id,
  text,
  notes,
  targetWpm,
  speed,
  practice,
  stopMedia,
}: {
  id: string;
  text: string;
  notes?: string;
  targetWpm: number;
  speed: number;
  practice: (mode: PracticeMode) => void;
  stopMedia: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const checkAnswer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecked(typed);
    if (typed.trim()) {
      practice("dictation");
    }
  };

  // Try again removes itself, so focus goes back to the answer field.
  const tryAgain = () => {
    setTyped("");
    setChecked(null);
    inputRef.current?.focus();
  };

  return (
    <VStack gap={1}>
      <Button
        label="Play"
        variant="secondary"
        isDisabled={!speechSupported}
        onClick={() => {
          stopMedia();
          speak(text, targetWpm, speed);
        }}
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
            ref={inputRef}
            id={`dictation-${id}`}
            className={stylex.props(appStyles.dictationInput).className}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <Button label="Check" variant="primary" type="submit" />
        </VStack>
      </form>
      <Status>
        {checked !== null && (
          <WordDiffResult text={text} answer={checked} verb="typed" notes={notes} />
        )}
      </Status>
      {checked !== null && <Button label="Try again" variant="ghost" onClick={tryAgain} />}
    </VStack>
  );
}

function SentenceBlank({
  id,
  text,
  targetWpm,
  speed,
  practice,
  stopMedia,
}: {
  id: string;
  text: string;
  targetWpm: number;
  speed: number;
  practice: (mode: PracticeMode) => void;
  stopMedia: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { parts, index, answer } = blankFor(text);
  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  if (index === -1) {
    return <Text as="p">{text}</Text>;
  }

  const checkAnswer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCorrect(normalize(typed) === answer);
    if (typed.trim()) {
      practice("blank");
    }
  };

  const tryAgain = () => {
    setTyped("");
    setCorrect(null);
    inputRef.current?.focus();
  };

  return (
    <VStack gap={1}>
      <Text as="p">
        {parts.map((part, i) => (i === index ? "____" : part)).join("")}
      </Text>
      <Button
        label="Play"
        variant="secondary"
        isDisabled={!speechSupported}
        onClick={() => {
          stopMedia();
          speak(text, targetWpm, speed);
        }}
      />
      {!speechSupported && (
        <Text as="p" type="supporting">
          Play disabled: speech synthesis is not supported in this browser.
        </Text>
      )}
      <form onSubmit={checkAnswer}>
        <VStack gap={1}>
          <label htmlFor={`blank-${id}`}>
            <Text as="span" type="supporting">
              Which word fills the blank?
            </Text>
          </label>
          <input
            ref={inputRef}
            id={`blank-${id}`}
            className={stylex.props(appStyles.dictationInput).className}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <Button label="Check" variant="primary" type="submit" />
        </VStack>
      </form>
      <Status>
        {correct !== null && (
          <Text as="p" weight="semibold">
            {correct ? "Correct" : `Not quite — the word was ${parts[index]}`}
          </Text>
        )}
      </Status>
      {correct !== null && <Button label="Try again" variant="ghost" onClick={tryAgain} />}
    </VStack>
  );
}

// The page's one h1 names the current view and takes focus when the user changes view.
function ViewHeading({ children, takeFocus }: { children: ReactNode; takeFocus: () => boolean }) {
  return (
    <Heading
      level={1}
      tabIndex={-1}
      ref={(heading) => {
        if (heading && takeFocus()) {
          heading.focus();
        }
      }}
    >
      {children}
    </Heading>
  );
}

function ErrorMessage({ error, subject }: { error: Error; subject: string }) {
  const message = error instanceof NotFoundError ? "not found" : error.message;

  return (
    <Text as="p" role="alert" color="primary" xstyle={appStyles.error}>
      Unable to load {subject}: {message}
    </Text>
  );
}

const syncMessages: Record<Exclude<SyncStatus, "signedOut">, string | null> = {
  synced: null,
  failed: "Couldn't sync. Your changes are saved on this device and will sync when you're back online.",
  ownerMismatch: "This device's data belongs to another account, so sync is off. Sign in with that account to sync.",
};

const passwordPolicyMessage =
  "Password must be at least 8 characters (and at most 72 bytes).";

function AccountError({ error, isSignUp }: { error: Error; isSignUp: boolean }) {
  let message = "Can't reach the server. You can keep practising on this device.";
  if (error instanceof ApiError) {
    message = "Unable to complete account request. Please try again.";
    if (error.status === 409) {
      message = "This email is already registered.";
    } else if (error.status === 401) {
      message = "Invalid email or password.";
    } else if (error.status === 429) {
      message = "Too many attempts. Try again in a few minutes.";
    } else if (error.status === 400 && isSignUp) {
      message = `Check your email address and password. ${passwordPolicyMessage}`;
    }
  }

  return (
    <Text as="p" role="alert" color="primary" xstyle={appStyles.error}>
      {message}
    </Text>
  );
}

function AccountArea({ auth }: { auth: AuthState }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lastAction, setLastAction] = useState<"signIn" | "signUp" | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  // Signing in or out swaps the form and the signed-in row, so focus moves to the control that replaced it.
  const moveFocus = useRef<"signedIn" | "signedOut" | null>(null);
  const takeFocus = (target: "signedIn" | "signedOut") => (element: HTMLElement | null) => {
    if (element && moveFocus.current === target) {
      moveFocus.current = null;
      element.focus();
    }
  };

  const submit = async (action: AuthState["signIn"], isSignUp: boolean) => {
    setLastAction(isSignUp ? "signUp" : "signIn");
    setLocalError(null);
    if (isSignUp && (Array.from(password).length < 8 || new TextEncoder().encode(password).byteLength > 72)) {
      setLocalError(passwordPolicyMessage);
      return;
    }
    moveFocus.current = "signedIn";
    try {
      await action(email, password);
      setPassword("");
    } catch {
      moveFocus.current = null;
      // The hook exposes the error for the inline account message.
    }
  };

  if (auth.user) {
    return (
      <VStack gap={1}>
        <HStack gap={1} align="center" xstyle={appStyles.accountControls}>
          <Text type="supporting">{auth.user.email}</Text>
          <Button
            ref={takeFocus("signedIn")}
            label="Sign out"
            variant="secondary"
            onClick={() => {
              moveFocus.current = "signedOut";
              auth.signOut().catch(() => {
                moveFocus.current = null;
              });
            }}
          />
        </HStack>
        {auth.error && <AccountError error={auth.error} isSignUp={false} />}
      </VStack>
    );
  }

  return (
    <VStack gap={1}>
      <form ref={form} onSubmit={(event) => {
        event.preventDefault();
        void submit(auth.signIn, false);
      }}>
        <HStack gap={1} align="center" xstyle={appStyles.accountControls}>
          <input
            ref={takeFocus("signedOut")}
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
          {/* Enter submits the form, so its default action, Sign in, is the primary button. */}
          <Button label="Sign in" variant="primary" type="submit" />
          <Button
            label="Sign up"
            variant="secondary"
            type="button"
            onClick={() => {
              if (form.current?.reportValidity()) {
                void submit(auth.signUp, true);
              }
            }}
          />
        </HStack>
      </form>
      {auth.expired && (
        <Text as="p" role="alert" color="primary" xstyle={appStyles.error}>
          You were signed out. Sign in again to sync.
        </Text>
      )}
      {localError && (
        <Text as="p" role="alert" color="primary" xstyle={appStyles.error}>
          {localError}
        </Text>
      )}
      {auth.error && <AccountError error={auth.error} isSignUp={lastAction === "signUp"} />}
    </VStack>
  );
}

function LessonRow({
  title,
  level,
  sentenceCount,
  targetWpm,
  completed,
  onSelect,
  takeFocus,
}: {
  title: string;
  level: Level;
  sentenceCount: number;
  targetWpm: number;
  completed: boolean;
  onSelect: () => void;
  takeFocus: () => boolean;
}) {
  return (
    <Button
      ref={(button) => {
        if (button && takeFocus()) {
          button.focus();
        }
      }}
      label={title}
      variant="secondary"
      xstyle={appStyles.lessonButton}
      onClick={onSelect}
    >
      <HStack justify="between" align="center" width="100%" xstyle={appStyles.lessonRowContent}>
        <VStack gap={0.5} align="start">
          <Text weight="semibold">{title}</Text>
          <Text type="supporting">
            {level} · {sentenceCount} sentences
          </Text>
        </VStack>
        <HStack gap={1} align="center">
          <Badge label={`${targetWpm} WPM`} variant="info" />
          {completed && <Badge label="Completed" variant="success" />}
        </HStack>
      </HStack>
    </Button>
  );
}

function TodayStrip({
  due,
  actionsToday,
  dailyGoal,
  nextLesson,
  onReview,
  onStart,
}: {
  due: number | null;
  actionsToday: number;
  dailyGoal: DailyGoal;
  nextLesson: { title: string } | undefined;
  onReview: () => void;
  onStart: () => void;
}) {
  const cards = (count: number) => `${count} card${count === 1 ? "" : "s"}`;
  return (
    <Card padding={2} xstyle={appStyles.sentence}>
      <HStack gap={1} align="center" xstyle={appStyles.shadowingControls}>
        <Heading level={2}>Today</Heading>
        <Text type="supporting">
          {due !== null && `${cards(due)} due · `}Goal {actionsToday}/{dailyGoal}
        </Text>
        {due ? (
          <Button label={`Review ${cards(due)}`} variant="primary" onClick={onReview} />
        ) : (
          nextLesson && (
            <>
              <Text type="supporting">Next: {nextLesson.title}</Text>
              <Button label="Start lesson" variant="primary" onClick={onStart} />
            </>
          )
        )}
      </HStack>
    </Card>
  );
}

function LessonList({
  onSelect,
  completedLessons,
  takeFocus,
  today,
}: {
  onSelect: (id: string) => void;
  completedLessons: Set<string>;
  takeFocus: (id: string) => boolean;
  today: Omit<Parameters<typeof TodayStrip>[0], "nextLesson" | "onStart">;
}) {
  const { data, loading, error, retry } = useLessons();
  // The first library lesson not yet completed; the strip reads the list this component already loads.
  const nextLesson = data?.find((lesson) => !completedLessons.has(lesson.id));

  let content: ReactNode;
  if (loading) {
    content = <Text as="p">Loading lessons...</Text>;
  } else if (error) {
    content = (
      <VStack gap={1}>
        <ErrorMessage error={error} subject="lessons" />
        <Text as="p" type="supporting">
          Your own lessons below still work offline.
        </Text>
        <Button label="Retry" variant="secondary" xstyle={appStyles.viewToggle} onClick={retry} />
      </VStack>
    );
  } else if (!data || data.length === 0) {
    content = <Text as="p">No lessons available.</Text>;
  } else {
    content = (
      <VStack as="ul" gap={2} padding={0}>
        {data.map((lesson) => (
          <li key={lesson.id}>
            <LessonRow
              title={lesson.title}
              level={lesson.level}
              sentenceCount={lesson.sentenceCount}
              targetWpm={lesson.targetWpm}
              completed={completedLessons.has(lesson.id)}
              onSelect={() => onSelect(lesson.id)}
              takeFocus={() => takeFocus(lesson.id)}
            />
          </li>
        ))}
      </VStack>
    );
  }

  return (
    <VStack gap={4}>
      <TodayStrip {...today} nextLesson={nextLesson} onStart={() => nextLesson && onSelect(nextLesson.id)} />
      {content}
    </VStack>
  );
}

function UserLessonList({
  lessons,
  onSelect,
  onDelete,
  deleteFailedId,
  completedLessons,
  takeFocus,
}: {
  lessons: Lesson[] | Error | null;
  onSelect: (lesson: Lesson) => void;
  onDelete: (lesson: Lesson) => void;
  deleteFailedId: string | null;
  completedLessons: Set<string>;
  takeFocus: (id: string) => boolean;
}) {
  if (lessons === null) {
    return <Text as="p">Loading your lessons...</Text>;
  }

  if (lessons instanceof Error) {
    return <ErrorMessage error={lessons} subject="your lessons" />;
  }

  if (lessons.length === 0) {
    return <Text as="p">No lessons of your own yet.</Text>;
  }

  return (
    <VStack as="ul" gap={2} padding={0}>
      {lessons.map((lesson) => (
        <li key={lesson.id}>
          <HStack gap={1} align="center">
            <LessonRow
              title={lesson.title}
              level={lesson.level}
              sentenceCount={lesson.sentences.length}
              targetWpm={lesson.targetWpm}
              completed={completedLessons.has(lesson.id)}
              onSelect={() => onSelect(lesson)}
              takeFocus={() => takeFocus(lesson.id)}
            />
            <Button
              label="Delete"
              aria-label={`Delete ${lesson.title}`}
              variant="ghost"
              onClick={() => onDelete(lesson)}
            />
          </HStack>
          {deleteFailedId === lesson.id && (
            <Text as="p" role="alert" color="primary" xstyle={appStyles.error}>
              Couldn't delete. Try again.
            </Text>
          )}
        </li>
      ))}
    </VStack>
  );
}

function ImportTextForm({ onCreate }: { onCreate: (lesson: Lesson) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [level, setLevel] = useState<Level>("B1");
  const [targetWpm, setTargetWpm] = useState<(typeof USER_WPMS)[number]>("110");
  const [error, setError] = useState<string | null>(null);
  const isCreatingRef = useRef(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isCreatingRef.current) {
      return;
    }

    isCreatingRef.current = true;
    try {
      await onCreate(createUserLesson({ title, text, level, targetWpm: Number(targetWpm), videoUrl: videoUrl.trim() }));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create lesson.");
    } finally {
      isCreatingRef.current = false;
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <VStack gap={1}>
        <Heading level={2}>Import text</Heading>
        <Text as="p" type="supporting">
          Your lessons stay on this device; export a backup to move them.
        </Text>
        <label htmlFor="import-title">
          <Text as="span" type="supporting">Title</Text>
        </label>
        <input
          id="import-title"
          className={stylex.props(appStyles.dictationInput).className}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label htmlFor="import-video">
          <Text as="span" type="supporting">YouTube URL</Text>
        </label>
        <input
          id="import-video"
          type="url"
          className={stylex.props(appStyles.dictationInput).className}
          value={videoUrl}
          onChange={(event) => setVideoUrl(event.target.value)}
        />
        <label htmlFor="import-text">
          <Text as="span" type="supporting">Text</Text>
        </label>
        <textarea
          id="import-text"
          className={stylex.props(appStyles.importTextArea).className}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <HStack gap={1} align="center" xstyle={appStyles.shadowingControls}>
          <ToggleButtonGroup
            label="Level"
            value={level}
            onChange={(nextLevel) => {
              if (nextLevel) {
                setLevel(nextLevel as Level);
              }
            }}
          >
            {USER_LEVELS.map((value) => (
              <ToggleButton key={value} value={value} label={value} />
            ))}
          </ToggleButtonGroup>
          <ToggleButtonGroup
            label="Target WPM"
            value={targetWpm}
            xstyle={appStyles.shadowingControls}
            onChange={(nextWpm) => {
              if (nextWpm) {
                setTargetWpm(nextWpm as (typeof USER_WPMS)[number]);
              }
            }}
          >
            {USER_WPMS.map((value) => (
              <ToggleButton key={value} value={value} label={`${value} WPM`} />
            ))}
          </ToggleButtonGroup>
        </HStack>
        <Button label="Create" variant="primary" type="submit" />
        {error && (
          <Text as="p" role="alert" color="primary" xstyle={appStyles.error}>
            {error}
          </Text>
        )}
        <Text as="p" type="supporting">
          Paste the transcript from YouTube's Show transcript panel (timestamps included).
        </Text>
      </VStack>
    </form>
  );
}

function SaveToReview({
  card,
  label,
  saved,
  addCard,
  removeCard,
  undoRemove,
}: {
  card: NewCard;
  label: string;
  saved: boolean;
  addCard: (input: NewCard) => Promise<void>;
  removeCard: (id: string) => Promise<VocabCard>;
  undoRemove: (tombstone: VocabCard) => Promise<boolean>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const isSavingRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const showToast = useToast();

  const undo = async (tombstone: VocabCard, dismiss: () => void) => {
    dismiss();
    try {
      if (!(await undoRemove(tombstone))) {
        showToast({ body: "Couldn't undo: this card changed since it was removed." });
      }
    } catch {
      showToast({ body: "Couldn't undo. Try again." });
    }
    // The dismissed toast took the focused Undo with it; the toggle it undid is the next target.
    buttonRef.current?.focus();
  };

  const toggle = async () => {
    if (isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setFailed(false);
    try {
      if (saved) {
        const tombstone = await removeCard(cardId(card.source));
        const dismiss = showToast({
          body: "Removed from your review deck.",
          endContent: <Button label="Undo" variant="secondary" size="sm" onClick={() => void undo(tombstone, dismiss)} />,
        });
      } else {
        await addCard(card);
      }
    } catch {
      setFailed(true);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <>
      <Button
        ref={buttonRef}
        label={saved ? "Saved" : label}
        aria-label={saved ? "Saved, remove from review deck" : undefined}
        variant="ghost"
        isDisabled={isSaving}
        // A tooltip makes Astryx use aria-disabled, so the pressed button keeps keyboard focus.
        tooltip={isSaving ? "Saving…" : saved ? "Remove from your review deck" : undefined}
        onClick={() => void toggle()}
      />
      {failed && (
        <Text as="p" role="alert" color="primary" xstyle={appStyles.error}>
          Couldn't save. Try again.
        </Text>
      )}
    </>
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

function downloadText(text: string, type: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  link.remove();
  URL.revokeObjectURL?.(url);
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
      {splitWords(text).map((part, index) => {
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
  removeCard,
  undoRemove,
  hear,
}: {
  text: string;
  card: NewCard;
  savedCardIds: Set<string>;
  addCard: (input: NewCard) => Promise<void>;
  removeCard: (id: string) => Promise<VocabCard>;
  undoRemove: (tombstone: VocabCard) => Promise<boolean>;
  hear: () => void;
}) {
  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  // Lookups keep an inner apostrophe ("don't") but drop quote marks; the card id uses the normalised word.
  const word = text.toLowerCase().replace(/’/g, "'").replace(/^'+|'+$/g, "");
  // The panel is keyed by word, so a late response for a previous word lands on an unmounted panel.
  const [lookup, setLookup] = useState<"idle" | "pending" | "unreachable" | Definition | null>("idle");

  const define = async () => {
    setLookup("pending");
    try {
      setLookup(await lookupWord(word));
    } catch {
      setLookup("unreachable");
    }
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
          removeCard={removeCard}
          undoRemove={undoRemove}
        />
        <Button
          label="Define"
          variant="secondary"
          isDisabled={lookup === "pending"}
          tooltip={lookup === "pending" ? "Looking up…" : undefined}
          onClick={() => void define()}
        />
        <Link
          href={"https://youglish.com/pronounce/" + encodeURIComponent(word) + "/english"}
          target="_blank"
          rel="noopener noreferrer"
          xstyle={appStyles.tapTarget}
        >
          Hear it on YouGlish
        </Link>
      </HStack>
      <Status>
        {lookup === "pending" && <Text as="p" type="supporting">Looking up…</Text>}
        {lookup === null && <Text as="p" type="supporting">No definition</Text>}
        {lookup === "unreachable" && (
          <Text as="p" type="supporting">Couldn't reach the dictionary. Check your connection.</Text>
        )}
        {typeof lookup === "object" && lookup !== null && (
          <Text as="p">
            {lookup.phonetic && `${lookup.phonetic} · `}
            <Text weight="semibold">{lookup.partOfSpeech}</Text> — {lookup.definition}
          </Text>
        )}
      </Status>
    </VStack>
  );
}

// Word cards store `${sentence} — ${vi}` (see LessonDetail). Only library lessons have Vietnamese:
// user lessons keep vi empty, and library text has no " — ", so the split is unambiguous.
function CardBack({ card }: { card: VocabCard }) {
  const split = card.back.lastIndexOf(" — ");
  if (card.source.word === "" || card.source.lessonId.startsWith("user-") || split === -1) {
    return card.back;
  }
  return (
    <>
      {card.back.slice(0, split + 3)}
      <span lang="vi">{card.back.slice(split + 3)}</span>
    </>
  );
}

function ReviewDeck({
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
        <Button label="Go to library" variant="secondary" xstyle={appStyles.viewToggle} onClick={onGoToLibrary} />
      </VStack>
    );
  }

  const rateErrorLine = rateError !== null && (
    <Text as="p" role="alert" color="primary" xstyle={appStyles.error}>
      {rateError}
    </Text>
  );

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
        <Button label="Go to library" variant="secondary" xstyle={appStyles.viewToggle} onClick={onGoToLibrary} />
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
      <Card padding={3} xstyle={appStyles.reviewCard}>
        <VStack gap={2}>
          <Text as="p" weight="semibold" ref={promptRef} tabIndex={-1}>{card.front}</Text>
          {showAnswer && (
            <Text as="p" xstyle={appStyles.answer} ref={answerRef} tabIndex={-1}><CardBack card={card} /></Text>
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

type LessonMode = "shadow" | "dictation" | "blank";

interface LessonDetailProps {
  onBack: () => void;
  savedCardIds: Set<string>;
  addCard: (input: NewCard) => Promise<void>;
  removeCard: (id: string) => Promise<VocabCard>;
  undoRemove: (tombstone: VocabCard) => Promise<boolean>;
  recordPractice: (options: { newCard: boolean }) => Promise<void>;
  completedLessons: Set<string>;
  markLessonComplete: (lessonId: string) => Promise<void>;
  takeHeadingFocus: () => boolean;
}

function LibraryLessonDetail({ id, ...props }: LessonDetailProps & { id: string }) {
  const { data, loading, error } = useLesson(id);

  if (error) {
    return (
      <VStack gap={3}>
        <ViewHeading takeFocus={props.takeHeadingFocus}>Lesson unavailable</ViewHeading>
        <ErrorMessage error={error} subject="lesson" />
        <Button label="Back to lessons" variant="ghost" onClick={props.onBack} />
      </VStack>
    );
  }

  // useLesson starts loading for an id, so data is null only while loading.
  if (loading || !data) {
    return <Text as="p">Loading lesson...</Text>;
  }

  return <LessonDetail lesson={data} {...props} />;
}

function LessonDetail({
  lesson: data,
  onBack,
  savedCardIds,
  addCard,
  removeCard,
  undoRemove,
  recordPractice,
  completedLessons,
  markLessonComplete,
  takeHeadingFocus,
}: LessonDetailProps & { lesson: Lesson }) {
  const completed = completedLessons.has(data.id);
  const [mode, setMode] = useState<LessonMode>("shadow");
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>("1");
  const [loopingSentenceId, setLoopingSentenceId] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(true);
  const [showVietnamese, setShowVietnamese] = useState(false);
  const [pronunciationCheck, setPronunciationCheck] = useState(readPronunciationCheck);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const pronunciationSupported = recognitionSupported();
  const [selectedWord, setSelectedWord] = useState<{
    sentenceId: string;
    text: string;
  } | null>(null);
  const [spokenWord, setSpokenWord] = useState<{
    sentenceId: string;
    charIndex: number;
  } | null>(null);
  const [completeFailed, setCompleteFailed] = useState(false);
  // One practice medium at a time: starting reference speech, the video, a recording or a
  // pronunciation check first stops the others, in every sentence. The video's own play
  // stops the rest but not itself, and so does a recording's.
  const stopMedia = ({ keepVideo = false, keepAudio }: { keepVideo?: boolean; keepAudio?: HTMLAudioElement } = {}) => {
    setLoopingSentenceId(null);
    setSpokenWord(null);
    if ("speechSynthesis" in window) {
      stopSpeaking();
    }
    abortActiveRecognition();
    stopActiveRecording();
    recordingAudios.forEach((audio) => {
      if (audio !== keepAudio) {
        audio.pause();
      }
    });
    if (!keepVideo) {
      video.pauseClip();
    }
  };
  const video = useYouTubePlayer(data.videoId, () => stopMedia({ keepVideo: true }));
  // Opening and closing the disclosure disables or removes the focused control, so focus moves across.
  const disclosureFocus = useRef<"enable" | "toggle" | null>(null);
  const takeDisclosureFocus = (target: "enable" | "toggle") => (element: HTMLElement | null) => {
    if (element && disclosureFocus.current === target && !element.hasAttribute("disabled")) {
      disclosureFocus.current = null;
      element.focus();
    }
  };
  // Each sentence and mode counts once per lesson visit; retries are not counted.
  const practiced = useRef(new Set<string>());
  const practice = (sentenceId: string, mode: PracticeMode) => {
    const key = `${sentenceId}:${mode}`;
    if (practiced.current.has(key)) {
      return;
    }
    practiced.current.add(key);
    void recordPractice({ newCard: false });
  };

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        stopSpeaking();
      }
    };
  }, []);

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
        <ViewHeading takeFocus={takeHeadingFocus}>{data.title}</ViewHeading>
        <Text type="supporting">Level {data.level}</Text>
      </VStack>
      {data.videoId && (
        <VStack gap={1}>
          <div ref={video.containerRef} className={stylex.props(appStyles.video).className} />
          <Status>
            {video.status === "loading" && (
              <Text as="p" type="supporting">
                Loading video…
              </Text>
            )}
            {video.status === "failed" && (
              <Text as="p" color="primary" xstyle={appStyles.error}>
                The video couldn't load. You can keep practising with Listen.
              </Text>
            )}
          </Status>
          <Text as="p" type="supporting">
            Video from YouTube; playing it connects to YouTube.
          </Text>
        </VStack>
      )}
      <Button
        label={completed ? "Completed" : "Mark complete"}
        variant="secondary"
        isDisabled={completed}
        // A tooltip makes Astryx use aria-disabled, so the pressed button keeps keyboard focus.
        tooltip={completed ? "You completed this lesson" : undefined}
        onClick={() => {
          setCompleteFailed(false);
          markLessonComplete(data.id).catch(() => setCompleteFailed(true));
        }}
      />
      {completeFailed && (
        <Text as="p" role="alert" color="primary" xstyle={appStyles.error}>
          Couldn't save. Try again.
        </Text>
      )}
      <ToggleButtonGroup
        label="Lesson mode"
        value={mode}
        onChange={(nextMode) => {
          if (nextMode) {
            setMode(nextMode as LessonMode);
            setLoopingSentenceId(null);
            setSpokenWord(null);
          }
        }}
        xstyle={appStyles.modeToggle}
      >
        <ToggleButton value="shadow" label="Shadow" />
        <ToggleButton value="dictation" label="Dictation" />
        <ToggleButton value="blank" label="Fill the blank" />
      </ToggleButtonGroup>
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
        {mode === "shadow" && (
          <>
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
            <ToggleButton
              ref={takeDisclosureFocus("toggle")}
              label="Pronunciation check"
              isPressed={pronunciationSupported && pronunciationCheck}
              isDisabled={!pronunciationSupported || disclosureOpen}
              onPressedChange={(pressed) => {
                if (pressed) {
                  disclosureFocus.current = "enable";
                  setDisclosureOpen(true);
                } else {
                  localStorage.removeItem(PRONUNCIATION_CHECK_KEY);
                  setPronunciationCheck(false);
                }
              }}
            />
          </>
        )}
      </HStack>
      {mode === "shadow" && !pronunciationSupported && (
        <Text as="p" type="supporting">
          Pronunciation check disabled: speech recognition is not supported in this browser.
        </Text>
      )}
      {mode === "shadow" && disclosureOpen && (
        <Card padding={3} xstyle={appStyles.sentence}>
          <VStack gap={1}>
            <Text as="p">
              Pronunciation check uses your browser's speech recognition. In Chrome, your
              voice may be sent to Google's servers to be transcribed unless the browser
              recognises it on this device. Nothing is sent to road-to-english.
            </Text>
            <HStack gap={1}>
              <Button
                ref={takeDisclosureFocus("enable")}
                label="Enable"
                variant="primary"
                onClick={() => {
                  localStorage.setItem(PRONUNCIATION_CHECK_KEY, "on");
                  setPronunciationCheck(true);
                  disclosureFocus.current = "toggle";
                  setDisclosureOpen(false);
                }}
              />
              <Button
                label="Cancel"
                variant="ghost"
                onClick={() => {
                  disclosureFocus.current = "toggle";
                  setDisclosureOpen(false);
                }}
              />
            </HStack>
          </VStack>
        </Card>
      )}
      <VStack as="ol" gap={2} padding={0}>
        {data.sentences.map((sentence) => (
          <li key={sentence.id}>
            <Card padding={3} xstyle={appStyles.sentence}>
              {sentence.cue && (
                <Button
                  label="Play clip"
                  variant="secondary"
                  isDisabled={video.status !== "ready"}
                  onClick={() => {
                    const { cue } = sentence;
                    if (!cue) return;
                    stopMedia({ keepVideo: true });
                    video.playClip(cue, Number(speed));
                  }}
                />
              )}
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
                      <span lang="vi">{sentence.vi}</span>
                    </Text>
                  )}
                  {showTranscript && selectedWord?.sentenceId === sentence.id && (
                    <WordPanel
                      key={normalize(selectedWord.text)}
                      text={selectedWord.text}
                      card={{
                        front: selectedWord.text,
                        back: sentence.vi ? `${sentence.text} — ${sentence.vi}` : sentence.text,
                        source: {
                          lessonId: data.id,
                          sentenceId: sentence.id,
                          word: normalize(selectedWord.text),
                        },
                      }}
                      savedCardIds={savedCardIds}
                      addCard={addCard}
                      removeCard={removeCard}
                      undoRemove={undoRemove}
                      hear={() => {
                        stopMedia();
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
                    practice={(practiceMode) => practice(sentence.id, practiceMode)}
                    pronunciationCheck={pronunciationSupported && pronunciationCheck}
                    stopMedia={stopMedia}
                  />
                  <SaveToReview
                    card={sentenceCard(data.id, sentence)}
                    label="Save to review"
                    saved={savedCardIds.has(cardId(sentenceCard(data.id, sentence).source))}
                    addCard={addCard}
                    removeCard={removeCard}
                    undoRemove={undoRemove}
                  />
                </VStack>
              ) : (
                <VStack gap={1}>
                  {mode === "dictation" ? (
                    <SentenceDictation
                      id={sentence.id}
                      text={sentence.text}
                      notes={sentence.notes}
                      targetWpm={data.targetWpm}
                      speed={Number(speed)}
                      practice={(practiceMode) => practice(sentence.id, practiceMode)}
                      stopMedia={stopMedia}
                    />
                  ) : (
                    <SentenceBlank
                      id={sentence.id}
                      text={sentence.text}
                      targetWpm={data.targetWpm}
                      speed={Number(speed)}
                      practice={(practiceMode) => practice(sentence.id, practiceMode)}
                      stopMedia={stopMedia}
                    />
                  )}
                  <SaveToReview
                    card={sentenceCard(data.id, sentence)}
                    label="Save to review"
                    saved={savedCardIds.has(cardId(sentenceCard(data.id, sentence).source))}
                    addCard={addCard}
                    removeCard={removeCard}
                    undoRemove={undoRemove}
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
  const [selected, setSelected] = useState<
    { kind: "library"; id: string } | { kind: "user"; lesson: Lesson } | null
  >(null);
  const [userLessons, setUserLessons] = useState<Lesson[] | Error | null>(null);
  const [deleteFailedId, setDeleteFailedId] = useState<string | null>(null);
  const [view, setView] = useState<"library" | "review">("library");
  const [backupError, setBackupError] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const deck = useVocabDeck();
  const progress = useProgress();
  const reviewDeck = capNewCards(deck.due, progress.newCardsToday);
  const storageError =
    deck.error ?? progress.error ?? (userLessons instanceof Error ? userLessons : null);
  const [dailyGoal, setDailyGoal] = useState(readDailyGoal);
  const goalMet = progress.actionsToday >= Number(dailyGoal);
  const auth = useAuth();
  const { expire } = auth;
  const syncRef = useRef<SyncScheduler | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const returnFocusId = useRef<string | null>(null);
  const headingFocus = useRef(false);
  const userLessonsHeading = useRef<HTMLHeadingElement>(null);
  const [storageKept, setStorageKept] = useState<boolean | null>(null);
  const persistRequested = useRef(false);

  // A pending return focus is dropped once the user moves on, so a late row mount cannot steal focus.
  const showView = (nextView: "library" | "review") => {
    returnFocusId.current = null;
    headingFocus.current = true;
    setView(nextView);
  };

  const select = (next: { kind: "library"; id: string } | { kind: "user"; lesson: Lesson }) => {
    returnFocusId.current = null;
    headingFocus.current = true;
    setSelected(next);
  };

  const takeHeadingFocus = () => {
    const take = headingFocus.current;
    headingFocus.current = false;
    return take;
  };

  const takeReturnFocus = (id: string) => {
    if (returnFocusId.current !== id) {
      return false;
    }
    returnFocusId.current = null;
    return true;
  };

  // Ask once per app start; StrictMode's second effect run keeps the ref and skips.
  useEffect(() => {
    if (persistRequested.current) {
      return;
    }
    persistRequested.current = true;
    if (typeof navigator.storage?.persist !== "function") {
      setStorageKept(false);
      return;
    }
    navigator.storage.persist().then(setStorageKept, () => setStorageKept(false));
  }, []);

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
      (status) => {
        if (status === "signedOut") {
          expire();
          return;
        }
        setSyncMessage(syncMessages[status]);
      },
    );
    syncRef.current = scheduler;
    scheduler.trigger();
    const retry = () => {
      if (document.visibilityState === "visible") {
        scheduler.trigger();
      }
    };
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", retry);
      scheduler.stop();
      if (syncRef.current === scheduler) {
        syncRef.current = null;
      }
    };
  }, [auth.user, expire, deck.reload, progress.reload]);

  const loadUserLessons = () =>
    listUserLessons().catch((loadError: unknown) =>
      loadError instanceof Error ? loadError : new Error("Unable to load your lessons"),
    );

  const reloadUserLessons = async () => {
    setUserLessons(await loadUserLessons());
  };

  useEffect(() => {
    let active = true;
    void loadUserLessons().then((lessons) => {
      if (active) {
        setUserLessons(lessons);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const createLesson = async (lesson: Lesson) => {
    await putUserLesson(lesson);
    await reloadUserLessons();
    select({ kind: "user", lesson });
  };

  const deleteLesson = async (lesson: Lesson) => {
    if (!window.confirm(`Delete "${lesson.title}"? Cards saved from it stay in your deck.`)) {
      return;
    }
    setDeleteFailedId(null);
    try {
      await deleteUserLesson(lesson.id);
    } catch {
      setDeleteFailedId(lesson.id);
      return;
    }
    await reloadUserLessons();
    // The deleted row took the focused Delete with it.
    userLessonsHeading.current?.focus();
  };

  const exportBackup = async () => {
    setBackupError(null);
    try {
      downloadText(exportData(await exportBackupData(), new Date()), "application/json", backupFileName(new Date()));
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : "Unable to export backup.");
    }
  };

  const exportCsv = async () => {
    setBackupError(null);
    try {
      downloadText(cardsCsv(await getAllCards()), "text/csv;charset=utf-8", cardsCsvFileName(new Date()));
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : "Unable to export CSV.");
    }
  };

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    setBackupError(null);
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }

    try {
      const data = importData(await file.text());
      const replaceNotice = "Importing this backup will replace all local data on this device.";
      const confirmText = auth.user
        ? `${replaceNotice} Your next sync merges it with your account, so cards and progress already in your account stay. Continue?`
        : `${replaceNotice} Continue?`;
      if (!window.confirm(confirmText)) {
        return;
      }
      await replaceAll(data);
      await Promise.all([deck.reload(), progress.reload(), reloadUserLessons()]);
      setSelected(null);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : "Unable to import backup.");
    }
  };

  const detailProps: LessonDetailProps = {
    onBack: () => {
      returnFocusId.current = selected?.kind === "user" ? selected.lesson.id : (selected?.id ?? null);
      headingFocus.current = false;
      setSelected(null);
    },
    savedCardIds: deck.savedCardIds,
    addCard: deck.addCard,
    removeCard: deck.removeCard,
    undoRemove: deck.undoRemove,
    recordPractice: progress.recordPractice,
    completedLessons: progress.completedLessons,
    markLessonComplete: progress.markLessonComplete,
    takeHeadingFocus,
  };

  return (
    <Theme theme={neutralTheme}>
      <div className={stylex.props(appStyles.page).className}>
        <div className={stylex.props(appStyles.content).className}>
          <VStack gap={4}>
            <VStack as="header" gap={1} xstyle={appStyles.header}>
              <HStack gap={1} align="center" xstyle={appStyles.shadowingControls}>
                <Badge
                  label={`${progress.streak} day${progress.streak === 1 ? "" : "s"} streak`}
                  variant="info"
                />
                <HStack as="span" gap={1} align="center" role="status" xstyle={appStyles.shadowingControls}>
                  <Badge label={`${progress.xp} XP`} variant="info" />
                  <Badge
                    label={`Goal ${progress.actionsToday}/${dailyGoal}`}
                    variant={goalMet ? "success" : "info"}
                  />
                </HStack>
                <Badge label={`Freezes ${progress.freezes}/2`} variant="info" />
                <Badge
                  label={progress.practicedToday ? "Practiced today" : "Not practiced today"}
                  variant={progress.practicedToday ? "success" : "info"}
                />
                <ToggleButtonGroup
                  label="Daily goal: practice actions per day"
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
              <HStack gap={1} align="center" xstyle={appStyles.shadowingControls}>
                <Button label="Export" variant="secondary" onClick={() => void exportBackup()} />
                <Button label="Export CSV" variant="secondary" onClick={() => void exportCsv()} />
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
              {storageKept !== null && (
                <Text type="supporting">
                  {storageKept
                    ? "Storage: kept on this device."
                    : "Storage: the browser may clear this data when space is low. Export a backup or sign in to keep it."}
                </Text>
              )}
              {storageError && (
                <Text as="p" role="alert" color="primary" xstyle={appStyles.error}>
                  Your saved data couldn't be read or saved on this device: {storageError.message}. Reload to try again.
                </Text>
              )}
              {backupError && (
                <Text as="p" role="alert" color="primary" xstyle={appStyles.error}>
                  Backup error: {backupError}
                </Text>
              )}
              <Status>
                {syncMessage && (
                  <Text as="p" color="primary" xstyle={appStyles.error}>
                    {syncMessage}
                  </Text>
                )}
              </Status>
              <AccountArea auth={auth} />
            </VStack>
            <nav aria-label="Views" className={stylex.props(appStyles.viewToggle).className}>
              <ToggleButtonGroup
                label="App view"
                value={view}
                onChange={(nextView) => {
                  if (nextView) {
                    showView(nextView as "library" | "review");
                  }
                }}
              >
                <ToggleButton value="library" label="Library" />
                <ToggleButton value="review" label="Review" />
              </ToggleButtonGroup>
            </nav>
            <VStack as="main" gap={4}>
              {(view === "review" || selected === null) && (
                <VStack gap={1}>
                  <ViewHeading takeFocus={takeHeadingFocus}>
                    {view === "library" ? "Lesson library" : "Review deck"}
                  </ViewHeading>
                  <Text type="large">
                    {view === "library"
                      ? "Choose a lesson to practise reading and speaking."
                      : "Review saved sentences with spaced repetition."}
                  </Text>
                </VStack>
              )}
              {view === "review" ? (
                <VStack gap={2}>
                  <Badge label={`${reviewDeck.length} due`} variant="info" />
                  <ReviewDeck
                    due={reviewDeck}
                    hiddenNew={deck.due.length - reviewDeck.length}
                    nextDueInMinutes={deck.nextDueInMinutes}
                    hasCards={deck.savedCardIds.size > 0}
                    loading={deck.loading}
                    loadFailed={deck.error !== null}
                    review={deck.review}
                    recordPractice={progress.recordPractice}
                    onGoToLibrary={() => showView("library")}
                  />
                </VStack>
              ) : selected === null ? (
                <VStack gap={4}>
                  <LessonList
                    onSelect={(id) => select({ kind: "library", id })}
                    completedLessons={progress.completedLessons}
                    takeFocus={takeReturnFocus}
                    today={{
                      due: deck.error === null ? reviewDeck.length : null,
                      actionsToday: progress.actionsToday,
                      dailyGoal,
                      onReview: () => showView("review"),
                    }}
                  />
                  <VStack gap={2}>
                    <Heading level={2} ref={userLessonsHeading} tabIndex={-1}>Your lessons</Heading>
                    <UserLessonList
                      lessons={userLessons}
                      onSelect={(lesson) => select({ kind: "user", lesson })}
                      onDelete={(lesson) => void deleteLesson(lesson)}
                      deleteFailedId={deleteFailedId}
                      completedLessons={progress.completedLessons}
                      takeFocus={takeReturnFocus}
                    />
                  </VStack>
                  <ImportTextForm onCreate={createLesson} />
                </VStack>
              ) : selected.kind === "library" ? (
                <LibraryLessonDetail id={selected.id} {...detailProps} />
              ) : (
                <LessonDetail lesson={selected.lesson} {...detailProps} />
              )}
            </VStack>
          </VStack>
        </div>
      </div>
    </Theme>
  );
}
