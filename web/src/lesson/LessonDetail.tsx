import { useEffect, useRef, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { Card } from "@astryxdesign/core/Card";
import { Switch } from "@astryxdesign/core/Switch";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { Lesson } from "../api/lessons";
import { ErrorMessage, Status, ViewHeading } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import { useLesson } from "../hooks/lessons";
import { useLessonProgress } from "../hooks/useLessonProgress";
import { usePracticeMedia } from "../hooks/usePracticeMedia";
import type { PracticeMode } from "../lib/progress";
import { PRONUNCIATION_CHECK_KEY, readPref, writePref } from "../lib/prefs";
import { recognitionSupported } from "../lib/recognition";
import { speechSupported, stopSpeaking } from "../lib/speech";
import { loadStressDict, type StressDict } from "../lib/stress";
import type { NewCard, VocabCard } from "../lib/vocab";
import { splitWords } from "../lib/words";
import { GuidedShadowing } from "./GuidedShadowing";
import { SentenceCard, type LessonMode } from "./SentenceCard";
import { LessonSummary, type SummaryProps } from "./LessonSummary";

const styles = stylex.create({
  video: {
    width: "100%",
    aspectRatio: "16 / 9",
  },
  modeToggle: {
    alignSelf: "start",
  },
});

const SPEEDS = ["0.5", "0.75", "1"] as const;

function readPronunciationCheck(): boolean {
  return readPref(PRONUNCIATION_CHECK_KEY) === "on";
}

const AUTO_HIDE_TEXT_KEY = "road-to-english.autoHideText";

function readAutoHideText(): boolean {
  return readPref(AUTO_HIDE_TEXT_KEY) === "on";
}

interface LessonDetailProps extends SummaryProps {
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

export function LibraryLessonDetail({ id, ...props }: LessonDetailProps & { id: string }) {
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

export function LessonDetail({
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
  ...summaryProps
}: LessonDetailProps & { lesson: Lesson }) {
  const completed = completedLessons.has(data.id);
  const [mode, setMode] = useState<LessonMode>("shadow");
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>("1");
  const [loopingSentenceId, setLoopingSentenceId] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(true);
  const [showVietnamese, setShowVietnamese] = useState(false);
  const [showStress, setShowStress] = useState(false);
  // Loaded on the first "Stress" press, so the dictionary chunk stays out of every other visit.
  const [stressDict, setStressDict] = useState<StressDict | "loading" | "failed" | null>(null);
  const loadedStressDict = typeof stressDict === "object" ? stressDict : null;
  const [pronunciationCheck, setPronunciationCheck] = useState(readPronunciationCheck);
  const [autoHideText, setAutoHideText] = useState(readAutoHideText);
  // Sentences whose text is hidden in shadow mode, for this lesson visit.
  const [hiddenText, setHiddenText] = useState<ReadonlySet<string>>(new Set());
  const setTextHidden = (sentenceId: string, hidden: boolean) =>
    setHiddenText((current) => {
      const next = new Set(current);
      if (hidden) next.add(sentenceId);
      else next.delete(sentenceId);
      return next;
    });
  // The sentence shown one at a time, or null for the full list; per visit.
  const [guidedIndex, setGuidedIndex] = useState<number | null>(null);
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
  // A1 blanks offer a word bank drawn from the whole lesson.
  const bankWords =
    data.level === "A1" ? data.sentences.flatMap((sentence) => splitWords(sentence.text)) : undefined;
  const { stopMedia, video } = usePracticeMedia(data.videoId, () => {
    setLoopingSentenceId(null);
    setSpokenWord(null);
  });
  // Opening and closing the disclosure disables or removes the focused control, so focus moves across.
  const disclosureFocus = useRef<"enable" | "toggle" | null>(null);
  const takeDisclosureFocus = (target: "enable" | "toggle") => (element: HTMLElement | null) => {
    if (element && disclosureFocus.current === target && !element.hasAttribute("disabled")) {
      disclosureFocus.current = null;
      element.focus();
    }
  };
  const { hasPracticed, allAttempted, practice, missed, miss, saveFailed, saveCompletion } = useLessonProgress(
    data,
    completed,
    recordPractice,
    markLessonComplete,
  );
  // With autoHideText on, a sentence's first recording or check this visit hides its text.
  const shadowPractice = (sentenceId: string, mode: PracticeMode) => {
    const first = !(["recording", "check"] as const).some((shadowMode) => hasPracticed(sentenceId, shadowMode));
    practice(sentenceId, mode);
    if (first && autoHideText) {
      setTextHidden(sentenceId, true);
    }
  };

  // Props shared by every sentence's card, in the list and the guided view.
  const cardProps = {
    lesson: data,
    mode,
    speed,
    video,
    stopMedia,
    showTranscript,
    showVietnamese,
    stressDict: showStress ? loadedStressDict : null,
    setTextHidden,
    selectedWord,
    setSelectedWord,
    spokenWord,
    setSpokenWord,
    loopingSentenceId,
    setLoopingSentenceId,
    pronunciationCheck: pronunciationSupported && pronunciationCheck,
    practice,
    shadowPractice,
    miss,
    bankWords,
    savedCardIds,
    addCard,
    removeCard,
    undoRemove,
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
          <div ref={video.containerRef} className={stylex.props(styles.video).className} />
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
      <ToggleButtonGroup
        label="Lesson mode"
        value={mode}
        onChange={(nextMode) => {
          if (nextMode) {
            setMode(nextMode as LessonMode);
            setGuidedIndex(null);
            stopMedia({ keepVideo: true });
          }
        }}
        xstyle={styles.modeToggle}
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
            <ToggleButton label="Transcript" isPressed={showTranscript} onPressedChange={setShowTranscript} />
            <ToggleButton label="Vietnamese" isPressed={showVietnamese} onPressedChange={setShowVietnamese} />
            <ToggleButton
              label="Stress"
              isPressed={showStress}
              onPressedChange={(pressed) => {
                setShowStress(pressed);
                if (pressed && (stressDict === null || stressDict === "failed")) {
                  setStressDict("loading");
                  loadStressDict().then(setStressDict, () => setStressDict("failed"));
                }
              }}
            />
            <ToggleButton
              label="One at a time"
              isPressed={guidedIndex !== null}
              onPressedChange={(pressed) => {
                stopMedia({ keepVideo: true });
                setGuidedIndex(pressed ? 0 : null);
              }}
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
                  writePref(PRONUNCIATION_CHECK_KEY, null);
                  setPronunciationCheck(false);
                }
              }}
            />
          </>
        )}
      </HStack>
      {mode === "shadow" && (
        <Switch
          label="Hide each sentence after I practise it"
          value={autoHideText}
          onChange={(checked) => {
            writePref(AUTO_HIDE_TEXT_KEY, checked ? "on" : null);
            setAutoHideText(checked);
          }}
        />
      )}
      {mode === "shadow" && (
        <Status>
          {showStress && stressDict === "failed" && (
            <Text as="p" color="primary" xstyle={sharedStyles.error}>
              Stress marks could not be loaded.
            </Text>
          )}
        </Status>
      )}
      {mode === "shadow" && showStress && loadedStressDict && (
        <Text as="p" type="supporting">
          Stress and intonation marks are auto-generated from a pronunciation dictionary and simple rules. They may
          be wrong.
        </Text>
      )}
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
                  writePref(PRONUNCIATION_CHECK_KEY, "on");
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
      {guidedIndex !== null ? (
        <GuidedShadowing
          index={guidedIndex}
          count={data.sentences.length}
          step={(index) => {
            stopMedia();
            setGuidedIndex(index);
          }}
        >
          {/* Keyed so a step to another sentence starts its practice afresh. */}
          <SentenceCard
            key={data.sentences[guidedIndex].id}
            sentence={data.sentences[guidedIndex]}
            textHidden={hiddenText.has(data.sentences[guidedIndex].id)}
            {...cardProps}
          />
        </GuidedShadowing>
      ) : (
        <VStack as="ol" gap={2} padding={0}>
          {data.sentences.map((sentence) => (
            <li key={sentence.id}>
              <SentenceCard
                key={sentence.id}
                sentence={sentence}
                textHidden={hiddenText.has(sentence.id)}
                {...cardProps}
              />
            </li>
          ))}
        </VStack>
      )}
      {allAttempted && (
        <LessonSummary
          lessonId={data.id}
          sentenceCount={data.sentences.length}
          saveFailed={saveFailed}
          retrySave={saveCompletion}
          onBack={onBack}
          missed={missed}
          savedCardIds={savedCardIds}
          addCard={addCard}
          removeCard={removeCard}
          undoRemove={undoRemove}
          {...summaryProps}
        />
      )}
      {/* Only a stored completion is announced; a failed save announces through its Alert. */}
      <VisuallyHidden>
        <Status>{allAttempted && completed && "Lesson complete."}</Status>
      </VisuallyHidden>
    </VStack>
  );
}
