import { useEffect, useRef, useState } from "react";

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

import type { Lesson } from "./api/lessons";
import { AccountArea } from "./components/AccountArea";
import { BackupControls } from "./components/BackupControls";
import { Alert, ErrorMessage, Status, ViewHeading } from "./components/feedback";
import { sharedStyles } from "./components/styles";
import { createSyncScheduler, type SyncScheduler, type SyncStatus } from "./lib/syncScheduler";
import { setSyncTrigger } from "./lib/syncEvents";
import { useAuth } from "./hooks/auth";
import { useLesson, useUserLessons } from "./hooks/lessons";
import { useProgress } from "./hooks/progress";
import { DAILY_GOALS, useDailyGoal, type DailyGoal } from "./hooks/useDailyGoal";
import { useVocabDeck } from "./hooks/vocab";
import { splitWords } from "./lib/dictation";
import { capNewCards, cardId, cardWord, isCardWord, sentenceCard, wordCardBack, type NewCard, type VocabCard } from "./lib/vocab";
import { speak, speechSupported, stopSpeaking } from "./lib/speech";
import { abortActiveRecognition, recognitionSupported, recognizeOnce } from "./lib/recognition";
import { lookupWord, type Definition } from "./lib/dictionary";
import { readRoute, routeHash, type Route } from "./lib/route";
import { recordingSupported, stopActiveRecording, useRecorder } from "./hooks/useRecorder";
import { useYouTubePlayer } from "./hooks/useYouTubePlayer";
import { SentenceBlank, SentenceDictation, WordDiffResult, type PracticeMode } from "./lesson/SentenceQuiz";
import { ImportTextForm } from "./library/ImportTextForm";
import { LessonList } from "./library/LessonList";
import { UserLessonList } from "./library/UserLessonList";
import { ReviewDeck } from "./review/ReviewDeck";

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
  modeToggle: {
    alignSelf: "start",
  },
  tapTarget: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "1.5rem",
  },
});

const SPEEDS = ["0.5", "0.75", "1"] as const;


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


// Every mounted recording player, across all sentences, so starting any medium can pause them.
const recordingAudios = new Set<HTMLAudioElement>();

// A clip shorter than this (a Record cut off by another medium) earns no recording XP.
const MIN_RECORDING_MS = 1000;

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
  const canSpeak = speechSupported();
  const listening = check.status === "listening";
  const canRecord = recordingSupported();

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
    if (recorder.state === "ready" && (recorder.durationMs ?? 0) >= MIN_RECORDING_MS) {
      practice("recording");
    }
  }, [practice, recorder.state, recorder.durationMs]);

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
      <HStack gap={1} xstyle={sharedStyles.shadowingControls}>
        <Button
          label="Listen"
          variant="secondary"
          isDisabled={!canSpeak || listening}
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
          isDisabled={!canSpeak || listening}
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
          isDisabled={!canRecord || recorder.state === "requesting"}
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
          isDisabled={!canSpeak || listening || !recorder.url}
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
      {!canSpeak && (
        <Text as="p" type="supporting">
          Listen disabled: speech synthesis is not supported in this browser.
        </Text>
      )}
      {!canRecord && (
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
          <Text as="p" color="primary" xstyle={sharedStyles.error}>
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
          <Text as="p" color="primary" xstyle={sharedStyles.error}>
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


const syncMessages: Record<Exclude<SyncStatus, "signedOut">, string | null> = {
  synced: null,
  failed: "Couldn't sync. Your changes are saved on this device and will sync when you're back online.",
  ownerMismatch: "This device's data belongs to another account, so sync is off. Sign in with that account to sync.",
};


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

  const undo = async (tombstone: VocabCard, dismiss: () => void, undoButton: HTMLElement) => {
    const toast = undoButton.closest("[data-toast-id]") ?? undoButton;
    dismiss();
    try {
      if (!(await undoRemove(tombstone))) {
        showToast({ body: "Couldn't undo: this card changed since it was removed." });
      }
    } catch {
      showToast({ body: "Couldn't undo. Try again." });
    }
    // The dismissed toast took the focused Undo with it; the toggle it undid is the next target,
    // unless the user moved focus elsewhere during the await.
    const active = document.activeElement;
    if (active === null || active === document.body || toast.contains(active)) {
      buttonRef.current?.focus();
    }
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
          endContent: <Button label="Undo" variant="secondary" size="sm" onClick={(event) => void undo(tombstone, dismiss, event.currentTarget)} />,
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
      {failed && <Alert>Couldn't save. Try again.</Alert>}
    </>
  );
}


// Splits on letter/digit runs (apostrophes kept, so "What's" is one word;
// hyphens inside join a compound, so "T-shirt" is one word) and renders each
// run whose cardWord() is a card word as a button; everything
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
        if (!isCardWord(cardWord(part))) {
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
  // Lookups keep an inner apostrophe ("don't") but drop quote marks and keep hyphens ("t-shirt"); the card id uses cardWord().
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
      <HStack gap={1} align="center" xstyle={sharedStyles.shadowingControls}>
        <Text weight="semibold">{text}</Text>
        <Button
          label="Hear word"
          variant="secondary"
          isDisabled={!speechSupported()}
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
    if (speechSupported()) {
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
      if (speechSupported()) {
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
              <Text as="p" color="primary" xstyle={sharedStyles.error}>
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
      {completeFailed && <Alert>Couldn't save. Try again.</Alert>}
      <ToggleButtonGroup
        label="Lesson mode"
        value={mode}
        onChange={(nextMode) => {
          if (nextMode) {
            setMode(nextMode as LessonMode);
            stopMedia({ keepVideo: true });
          }
        }}
        xstyle={appStyles.modeToggle}
      >
        <ToggleButton value="shadow" label="Shadow" />
        <ToggleButton value="dictation" label="Dictation" />
        <ToggleButton value="blank" label="Fill the blank" />
      </ToggleButtonGroup>
      <HStack gap={1} align="center" xstyle={sharedStyles.shadowingControls}>
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
        <Card padding={3} xstyle={sharedStyles.sentence}>
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
            <Card padding={3} xstyle={sharedStyles.sentence}>
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
                      key={cardWord(selectedWord.text)}
                      text={selectedWord.text}
                      card={{
                        front: selectedWord.text,
                        back: wordCardBack(sentence.text, sentence.vi),
                        source: {
                          lessonId: data.id,
                          sentenceId: sentence.id,
                          word: cardWord(selectedWord.text),
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
  const [route, setRoute] = useState(readRoute);
  const shownRoute = useRef(route);
  const { lessons: userLessons, reload: reloadUserLessons, create: createUserLesson, remove: removeUserLesson } = useUserLessons();
  const [deleteFailedId, setDeleteFailedId] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const deck = useVocabDeck();
  const progress = useProgress();
  const reviewDeck = capNewCards(deck.due, progress.newCardsToday);
  const storageError =
    deck.error ?? progress.error ?? (userLessons instanceof Error ? userLessons : null);
  const { dailyGoal, goalMet, goalAnnounced, armGoal, chooseGoal } = useDailyGoal(progress.actionsToday);
  const recordPractice = (options: { newCard: boolean }) => {
    armGoal();
    return progress.recordPractice(options);
  };
  const auth = useAuth();
  const { expire } = auth;
  const syncRef = useRef<SyncScheduler | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const returnFocusId = useRef<string | null>(null);
  const headingFocus = useRef(false);
  const [, setHeadingFocusRequest] = useState(0);
  const userLessonsHeading = useRef<HTMLHeadingElement>(null);
  const [storageKept, setStorageKept] = useState<boolean | null>(null);
  const persistRequested = useRef(false);

  // A user view change focuses the new h1, or the row of the lesson being left when returnTo names it.
  // A pending return focus is dropped once the user moves on, so a late row mount cannot steal focus.
  const show = (next: Route, returnTo: string | null) => {
    returnFocusId.current = returnTo;
    headingFocus.current = returnTo === null;
    shownRoute.current = next;
    setRoute(next);
  };

  // In-app navigation pushes an entry, so browser Back retraces it. In-app Back also pushes the
  // library rather than calling history.back(): after a deep link that would leave the app.
  const navigate = (next: Route, returnTo: string | null = null) => {
    if (routeHash(next) !== window.location.hash) {
      window.history.pushState(null, "", routeHash(next));
    }
    show(next, returnTo);
  };

  const lessonId = (at: Route) => (at.view === "lesson" || at.view === "my" ? at.id : null);

  // Browser Back/Forward and hash edits are user view changes; returning to the library from a
  // lesson focuses that lesson's row. Both events can fire for one change, so a repeat is ignored.
  useEffect(() => {
    const follow = () => {
      const next = readRoute();
      const previous = shownRoute.current;
      if (routeHash(next) === routeHash(previous)) {
        return;
      }
      show(next, next.view === "library" ? lessonId(previous) : null);
    };
    window.addEventListener("popstate", follow);
    window.addEventListener("hashchange", follow);
    return () => {
      window.removeEventListener("popstate", follow);
      window.removeEventListener("hashchange", follow);
    };
  }, []);

  // Focuses the current view's h1 when it has not changed: the re-render hands it takeHeadingFocus again.
  const focusHeading = () => {
    headingFocus.current = true;
    setHeadingFocusRequest((request) => request + 1);
  };

  const takeHeadingFocus = () => {
    const take = headingFocus.current;
    headingFocus.current = false;
    return take;
  };

  // Once both lesson lists have settled, a return focus no row took (an unknown lesson id, or a
  // list that failed) goes to the view's h1 instead of dropping to <body>. Either list may settle last.
  const librarySettled = useRef(false);
  const settleReturnFocus = () => {
    if (returnFocusId.current !== null && librarySettled.current && userLessons !== null) {
      returnFocusId.current = null;
      focusHeading();
    }
  };

  // User-lesson rows take the return focus as they mount, before this runs.
  useEffect(() => {
    settleReturnFocus();
  }, [userLessons]);

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

  const createLesson = async (lesson: Lesson) => {
    await createUserLesson(lesson);
    navigate({ view: "my", id: lesson.id });
  };

  const deleteLesson = async (lesson: Lesson) => {
    if (!window.confirm(`Delete "${lesson.title}"? Cards saved from it stay in your deck.`)) {
      return;
    }
    setDeleteFailedId(null);
    try {
      await removeUserLesson(lesson.id);
    } catch {
      setDeleteFailedId(lesson.id);
      return;
    }
    // The deleted row took the focused Delete with it.
    userLessonsHeading.current?.focus();
  };

  const reloadAfterImport = async () => {
    await Promise.all([deck.reload(), progress.reload(), reloadUserLessons()]);
    // The open lesson may be gone or replaced, so the view goes to the library.
    if (lessonId(shownRoute.current) !== null) {
      navigate({ view: "library" });
    }
  };

  const userLesson =
    route.view === "my" && Array.isArray(userLessons)
      ? userLessons.find((lesson) => lesson.id === route.id)
      : undefined;
  // A user-lesson route whose lesson is unknown or deleted shows the library, and the URL follows.
  const missingUserLesson = route.view === "my" && userLessons !== null && userLesson === undefined;
  const view = missingUserLesson ? "library" : route.view;

  useEffect(() => {
    if (missingUserLesson) {
      const library: Route = { view: "library" };
      window.history.replaceState(null, "", routeHash(library));
      shownRoute.current = library;
      setRoute(library);
    }
  }, [missingUserLesson]);

  const detailProps: LessonDetailProps = {
    onBack: () => navigate({ view: "library" }, lessonId(route)),
    savedCardIds: deck.savedCardIds,
    addCard: deck.addCard,
    removeCard: deck.removeCard,
    undoRemove: deck.undoRemove,
    recordPractice,
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
              <HStack gap={1} align="center" xstyle={sharedStyles.shadowingControls}>
                <Badge
                  label={`${progress.streak} day${progress.streak === 1 ? "" : "s"} streak`}
                  variant="info"
                />
                <Badge label={`${progress.xp} XP`} variant="info" />
                <Badge
                  label={`Goal ${progress.actionsToday}/${dailyGoal}`}
                  variant={goalMet ? "success" : "info"}
                />
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
                      chooseGoal(nextGoal as DailyGoal);
                    }
                  }}
                >
                  {DAILY_GOALS.map((value) => (
                    <ToggleButton key={value} value={value} label={value} />
                  ))}
                </ToggleButtonGroup>
              </HStack>
              {/* The badges change on every practice action; only reaching the goal is announced. */}
              <Status>
                {goalAnnounced && <Text type="supporting">Daily goal met.</Text>}
              </Status>
              <BackupControls signedIn={auth.user !== null} setError={setBackupError} onImported={reloadAfterImport} />
              {storageKept !== null && (
                <Text type="supporting">
                  {storageKept
                    ? "Storage: kept on this device."
                    : "Storage: the browser may clear this data when space is low. Export a backup or sign in to keep it."}
                </Text>
              )}
              {storageError && (
                <Alert>
                  Your saved data couldn't be read or saved on this device: {storageError.message}. Reload to try again.
                </Alert>
              )}
              {backupError && <Alert>Backup error: {backupError}</Alert>}
              <Status>
                {syncMessage && (
                  <Text as="p" color="primary" xstyle={sharedStyles.error}>
                    {syncMessage}
                  </Text>
                )}
              </Status>
              <AccountArea auth={auth} />
            </VStack>
            <nav aria-label="Views" className={stylex.props(sharedStyles.viewToggle).className}>
              <ToggleButtonGroup
                label="App view"
                value={view === "review" ? "review" : "library"}
                onChange={(nextView) => {
                  if (nextView) {
                    navigate({ view: nextView as "library" | "review" });
                  }
                }}
              >
                <ToggleButton value="library" label="Library" />
                <ToggleButton value="review" label="Review" />
              </ToggleButtonGroup>
            </nav>
            <VStack as="main" gap={4}>
              {(view === "review" || view === "library") && (
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
                    recordPractice={recordPractice}
                    onGoToLibrary={() => navigate({ view: "library" })}
                  />
                </VStack>
              ) : view === "library" ? (
                <VStack gap={4}>
                  <LessonList
                    onSelect={(id) => navigate({ view: "lesson", id })}
                    completedLessons={progress.completedLessons}
                    takeFocus={takeReturnFocus}
                    focusHeading={focusHeading}
                    onSettled={(settled) => {
                      librarySettled.current = settled;
                      settleReturnFocus();
                    }}
                    today={{
                      due: deck.error === null && !deck.loading ? reviewDeck.length : null,
                      actionsToday: progress.actionsToday,
                      dailyGoal,
                      onReview: () => navigate({ view: "review" }),
                    }}
                  />
                  <VStack gap={2}>
                    <Heading level={2} ref={userLessonsHeading} tabIndex={-1}>Your lessons</Heading>
                    <UserLessonList
                      lessons={userLessons}
                      onSelect={(lesson) => navigate({ view: "my", id: lesson.id })}
                      onDelete={(lesson) => void deleteLesson(lesson)}
                      deleteFailedId={deleteFailedId}
                      completedLessons={progress.completedLessons}
                      takeFocus={takeReturnFocus}
                    />
                  </VStack>
                  <ImportTextForm onCreate={createLesson} />
                </VStack>
              ) : route.view === "lesson" ? (
                <LibraryLessonDetail key={route.id} id={route.id} {...detailProps} />
              ) : userLesson ? (
                <LessonDetail key={userLesson.id} lesson={userLesson} {...detailProps} />
              ) : (
                <Text as="p">Loading lesson...</Text>
              )}
            </VStack>
          </VStack>
        </div>
      </div>
    </Theme>
  );
}
