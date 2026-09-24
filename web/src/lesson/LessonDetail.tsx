import { useEffect, useRef, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { Card } from "@astryxdesign/core/Card";
import { Switch } from "@astryxdesign/core/Switch";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { Lesson } from "../api/lessons";
import { Alert, ErrorMessage, Status, ViewHeading } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import { useLesson } from "../hooks/lessons";
import { usePracticeMedia } from "../hooks/usePracticeMedia";
import { splitWords } from "../lib/dictation";
import { recognitionSupported } from "../lib/recognition";
import { speak, speechSupported, stopSpeaking } from "../lib/speech";
import { cardId, cardWord, sentenceCard, wordCardBack, type NewCard, type VocabCard } from "../lib/vocab";
import { SentenceShadowing } from "./SentenceShadowing";
import { SentenceBlank, SentenceDictation, type PracticeMode } from "./SentenceQuiz";
import { SaveToReview, SentenceWords, WordPanel } from "./WordPanel";

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

const PRONUNCIATION_CHECK_KEY = "road-to-english.pronunciationCheck";

function readPronunciationCheck(): boolean {
  return localStorage.getItem(PRONUNCIATION_CHECK_KEY) === "on";
}

const AUTO_HIDE_TEXT_KEY = "road-to-english.autoHideText";

function readAutoHideText(): boolean {
  return localStorage.getItem(AUTO_HIDE_TEXT_KEY) === "on";
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
}: LessonDetailProps & { lesson: Lesson }) {
  const completed = completedLessons.has(data.id);
  const [mode, setMode] = useState<LessonMode>("shadow");
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>("1");
  const [loopingSentenceId, setLoopingSentenceId] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(true);
  const [showVietnamese, setShowVietnamese] = useState(false);
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
  // With autoHideText on, a sentence's first recording or check this visit hides its text.
  const shadowPractice = (sentenceId: string, mode: PracticeMode) => {
    const first = !["recording", "check"].some((shadowMode) => practiced.current.has(`${sentenceId}:${shadowMode}`));
    practice(sentenceId, mode);
    if (first && autoHideText) {
      setTextHidden(sentenceId, true);
    }
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
      {mode === "shadow" && (
        <Switch
          label="Hide each sentence after I practise it"
          value={autoHideText}
          onChange={(checked) => {
            if (checked) {
              localStorage.setItem(AUTO_HIDE_TEXT_KEY, "on");
            } else {
              localStorage.removeItem(AUTO_HIDE_TEXT_KEY);
            }
            setAutoHideText(checked);
          }}
        />
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
        {data.sentences.map((sentence) => {
          const textHidden = hiddenText.has(sentence.id);
          const showText = showTranscript && !textHidden;
          return (
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
                  <Button
                    label={textHidden ? "Show text" : "Hide text"}
                    variant="ghost"
                    xstyle={styles.modeToggle}
                    onClick={() => setTextHidden(sentence.id, !textHidden)}
                  />
                  {showText && (
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
                  {showText && sentence.notes && (
                    <Text as="p" type="supporting">
                      {sentence.notes}
                    </Text>
                  )}
                  {showVietnamese && !textHidden && (
                    <Text as="p" type="supporting">
                      <span lang="vi">{sentence.vi}</span>
                    </Text>
                  )}
                  {showText && selectedWord?.sentenceId === sentence.id && (
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
                    practice={(practiceMode) => shadowPractice(sentence.id, practiceMode)}
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
                      lessonWords={bankWords}
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
          );
        })}
      </VStack>
    </VStack>
  );
}
