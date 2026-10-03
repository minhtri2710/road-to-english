import { useEffect, useRef, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuDivider,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@astryxdesign/core/DropdownMenu";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Card } from "@astryxdesign/core/Card";
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
import {
  EMPTY_LEARN_PROGRESS,
  LEARN_MODE_KEY,
  onLearnProgressChanged,
  readLearnProgress,
  writeLearnProgress,
  type LearnProgress,
} from "../lib/learnProgress";
import { PRONUNCIATION_CHECK_KEY, readPref, writePref } from "../lib/prefs";
import { recognitionSupported } from "../lib/recognition";
import { speechSupported, stopSpeaking } from "../lib/speech";
import { loadStressDict, type StressDict } from "../lib/stress";
import type { NewCard, VocabCard } from "../lib/vocab";
import { splitWords } from "../lib/words";
import { GuidedShadowing, SKIPS_PER_LESSON } from "./GuidedShadowing";
import { SentenceCard, type LessonMode } from "./SentenceCard";
import { LearnTranscript } from "./LearnView";
import { LearnSentence } from "./LearnSentence";
import { LessonSummary, type SummaryProps } from "./LessonSummary";
import { useT } from "../i18n";

const styles = stylex.create({
  // A reading column; Learn mode one sentence at a time takes the full width for its transcript.
  column: {
    width: "100%",
    maxWidth: "48rem",
    marginInline: "auto",
  },
  wideColumn: {
    maxWidth: "none",
  },
  // The stage and shadow bar, with the transcript beside them on wide screens and below on narrow ones.
  learnLayout: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 1.6fr) minmax(0, 1fr)", "@media (max-width: 1023px)": "minmax(0, 1fr)" },
    gap: "var(--spacing-6)",
    alignItems: "start",
  },
  // The player and its caption strip share one dark frame.
  player: {
    overflow: "hidden",
    borderRadius: "var(--radius-container)",
    backgroundColor: "#0A0C0F",
    boxShadow: "var(--shadow-low)",
  },
  video: {
    width: "100%",
    aspectRatio: "16 / 9",
  },
  // Captions sit under the video, not over it, so they never cover the player's controls.
  caption: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--spacing-0-5)",
    padding: "var(--spacing-3) var(--spacing-4)",
    textAlign: "center",
  },
  captionEn: {
    margin: 0,
    color: "#FFFFFF",
    fontSize: "1.375rem",
    lineHeight: 1.45,
    fontWeight: "var(--font-weight-medium)",
  },
  captionVi: {
    margin: 0,
    color: "#C9CED6",
    fontSize: "1rem",
    lineHeight: 1.5,
  },
  toolbar: {
    flexWrap: "wrap",
    alignItems: "center",
  },
  // Enlarged text wraps the modes onto more rows instead of scrolling the page.
  modeControl: {
    flexWrap: "wrap",
    maxWidth: "100%",
  },
  displayMenu: {
    backgroundColor: "var(--color-background-popover)",
  },
  autoHideLabel: {
    whiteSpace: "normal",
    overflow: "visible",
    textOverflow: "clip",
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
  const t = useT();
  const { data, loading, error } = useLesson(id);

  if (error) {
    return (
      <VStack gap={3}>
        <ViewHeading takeFocus={props.takeHeadingFocus}>{t("Lesson unavailable")}</ViewHeading>
        <ErrorMessage error={error} subject="lesson" />
        <Button label={t("Back to lessons")} variant="ghost" onClick={props.onBack} />
      </VStack>
    );
  }

  // useLesson starts loading for an id, so data is null only while loading.
  if (loading || !data) {
    return <Text as="p">{t("Loading lesson...")}</Text>;
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
  const t = useT();
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
  // The sentence whose video clip played last, captioned under the video.
  const [clipSentenceId, setClipSentenceId] = useState<string | null>(null);

  // The sentence shown one at a time, or null for the full list; per visit.
  const [guidedIndex, setGuidedIndex] = useState<number | null>(null);
  // Learn mode (Shadow Gate) in the guided view. The mode is a device preference; the sentences passed or
  // skipped and the skips used are saved per lesson, backed up and synced.
  const [learn, setLearnState] = useState(() => readPref(LEARN_MODE_KEY) === "on");
  const setLearn = (on: boolean) => {
    writePref(LEARN_MODE_KEY, on ? "on" : null);
    setLearnState(on);
  };
  const [learnProgress, setLearnProgressState] = useState<LearnProgress>(EMPTY_LEARN_PROGRESS);
  // Set once this visit changes the progress, so a slower read cannot overwrite the change.
  const changedProgress = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const load = (fromElsewhere: boolean) => {
      readLearnProgress(data.id).then(
        (stored) => {
          if (!cancelled && (fromElsewhere || !changedProgress.current)) setLearnProgressState(stored);
        },
        () => undefined,
      );
    };
    load(false);
    // A sync or a backup import may change it while the lesson is open.
    const stop = onLearnProgressChanged(() => load(true));
    return () => {
      cancelled = true;
      stop();
    };
  }, [data.id]);
  const setLearnProgress = (next: LearnProgress) => {
    changedProgress.current = true;
    setLearnProgressState(next);
    writeLearnProgress(data.id, next).catch(() => undefined);
  };
  const passedIds = new Set(learnProgress.passed);
  const skipsUsed = learnProgress.skipsUsed;
  const pass = (sentenceId: string, skipped = false) =>
    setLearnProgress({
      passed: learnProgress.passed.includes(sentenceId) ? learnProgress.passed : [...learnProgress.passed, sentenceId],
      skipsUsed: learnProgress.skipsUsed + (skipped ? 1 : 0),
    });
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const displayButtonRef = useRef<HTMLButtonElement>(null);
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
  const disclosureFocus = useRef<"enable" | "display" | null>(null);
  const takeDisclosureFocus = (target: "enable") => (element: HTMLElement | null) => {
    if (element && disclosureFocus.current === target && !element.hasAttribute("disabled")) {
      disclosureFocus.current = null;
      element.focus();
    }
  };
  useEffect(() => {
    if (!disclosureOpen && disclosureFocus.current === "display") {
      disclosureFocus.current = null;
      displayButtonRef.current?.focus();
    }
  }, [disclosureOpen]);
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

  const learnAvailable = pronunciationSupported && pronunciationCheck;
  const learnOn = learn && learnAvailable;
  // Learn mode one sentence at a time: the stage and shadow bar, with the transcript beside them.
  const learnGuided = learnOn && guidedIndex !== null;
  // In Learn mode the video's caption follows the sentence being learned; elsewhere, the last clip played.
  const captionId = learnGuided ? data.sentences[guidedIndex].id : clipSentenceId;
  const clipSentence = data.sentences.find((sentence) => sentence.id === captionId) ?? null;
  // This visit's best score per sentence, for the transcript.
  const [scores, setScores] = useState<ReadonlyMap<string, number>>(new Map());

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
    // Learn mode's Shadow Gate takes over the check, so the card does not offer a second one.
    pronunciationCheck: pronunciationSupported && pronunciationCheck && !(learn && guidedIndex !== null),
    practice,
    shadowPractice,
    miss,
    bankWords,
    savedCardIds,
    addCard,
    removeCard,
    undoRemove,
    onPlayClip: setClipSentenceId,
  };
  const activeSentenceId = spokenWord?.sentenceId ?? loopingSentenceId ?? clipSentenceId;

  useEffect(() => {
    return () => {
      if (speechSupported()) {
        stopSpeaking();
      }
    };
  }, []);

  return (
    <VStack gap={4} xstyle={[styles.column, learnGuided && styles.wideColumn]}>
      <HStack justify="between" align="center" wrap="wrap">
        <Button label={t("Back to lessons")} variant="ghost" onClick={onBack} />
        <HStack gap={1} align="center">
          <Badge label={t("{wpm} WPM", { wpm: data.targetWpm })} variant="info" />
          {completed && <Badge label={t("Completed")} variant="success" />}
        </HStack>
      </HStack>
      <VStack gap={1}>
        <ViewHeading takeFocus={takeHeadingFocus}>{data.title}</ViewHeading>
        <Text type="supporting">{t("Level {level}", { level: data.level })}</Text>
      </VStack>
      {data.videoId && (
        <VStack gap={1}>
          <div className={stylex.props(styles.player).className}>
            <div ref={video.containerRef} className={stylex.props(styles.video).className} />
            {/* Hidden text stays hidden in the caption too. */}
            {clipSentence && showTranscript && !hiddenText.has(clipSentence.id) && (
              <div data-testid="video-caption" className={stylex.props(styles.caption).className}>
                <p className={stylex.props(styles.captionEn).className}>{clipSentence.text}</p>
                {showVietnamese && clipSentence.vi && (
                  <p lang="vi" className={stylex.props(styles.captionVi).className}>{clipSentence.vi}</p>
                )}
              </div>
            )}
          </div>
          <Status>
            {video.status === "loading" && (
              <Text as="p" type="supporting">
                {t("Loading video…")}
              </Text>
            )}
            {video.status === "failed" && (
              <Text as="p" color="primary" xstyle={sharedStyles.error}>
                {t("The video couldn't load. You can keep practising with Listen.")}
              </Text>
            )}
          </Status>
          <Text as="p" type="supporting">
            {t("Video from YouTube; playing it connects to YouTube.")}
          </Text>
        </VStack>
      )}
      <HStack gap={1} xstyle={styles.toolbar}>
        <SegmentedControl
          label={t("Lesson mode")}
          xstyle={styles.modeControl}
          value={mode}
          onChange={(nextMode) => {
            setMode(nextMode as LessonMode);
            setGuidedIndex(null);
            stopMedia({ keepVideo: true });
          }}
        >
          <SegmentedControlItem value="shadow" label={t("Shadow")} />
          <SegmentedControlItem value="dictation" label={t("Dictation")} />
          <SegmentedControlItem value="blank" label={t("Fill the blank")} />
        </SegmentedControl>
        <DropdownMenu
          button={{ label: t("Display"), variant: "secondary", ref: (element) => {
            displayButtonRef.current = element;
          } }}
          isMenuOpen={displayOpen}
          onOpenChange={setDisplayOpen}
          menuWidth={360}
          xstyle={styles.displayMenu}
        >
          <DropdownMenuRadioGroup
            label={t("Playback speed")}
            value={speed}
            onChange={(nextSpeed) => setSpeed(nextSpeed as (typeof SPEEDS)[number])}
          >
            {SPEEDS.map((value) => (
              <DropdownMenuRadioItem key={value} value={value} label={`${value}x`} />
            ))}
          </DropdownMenuRadioGroup>
          {mode === "shadow" && (
            <>
              <DropdownMenuDivider />
              <DropdownMenuCheckboxItem
                label={t("Transcript")}
                value={showTranscript}
                onChange={setShowTranscript}
              />
              <DropdownMenuCheckboxItem
                label={t("Vietnamese")}
                value={showVietnamese}
                onChange={setShowVietnamese}
              />
              <DropdownMenuCheckboxItem
                label={t("Stress")}
                value={showStress}
                onChange={(pressed) => {
                  setShowStress(pressed);
                  if (pressed && (stressDict === null || stressDict === "failed")) {
                    setStressDict("loading");
                    loadStressDict().then(setStressDict, () => setStressDict("failed"));
                  }
                }}
              />
              <DropdownMenuCheckboxItem
                label={t("One at a time")}
                value={guidedIndex !== null}
                onChange={(pressed) => {
                  stopMedia({ keepVideo: true });
                  setGuidedIndex(pressed ? 0 : null);
                }}
              />
              <DropdownMenuCheckboxItem
                label={t("Pronunciation check")}
                value={pronunciationSupported && pronunciationCheck}
                isDisabled={!pronunciationSupported}
                hasCloseOnSelect
                onChange={(pressed) => {
                  if (pressed) {
                    setDisplayOpen(false);
                    disclosureFocus.current = "enable";
                    setDisclosureOpen(true);
                  } else {
                    writePref(PRONUNCIATION_CHECK_KEY, null);
                    setPronunciationCheck(false);
                  }
                }}
              />
              <DropdownMenuCheckboxItem
                label={<span {...stylex.props(styles.autoHideLabel)}>{t("Hide each sentence after I practise it")}</span>}
                value={autoHideText}
                onChange={(checked) => {
                  writePref(AUTO_HIDE_TEXT_KEY, checked ? "on" : null);
                  setAutoHideText(checked);
                }}
              />
            </>
          )}
        </DropdownMenu>
      </HStack>
      {mode === "shadow" && (
        <Status>
          {showStress && stressDict === "failed" && (
            <Text as="p" color="primary" xstyle={sharedStyles.error}>
              {t("Stress marks could not be loaded.")}
            </Text>
          )}
        </Status>
      )}
      {mode === "shadow" && showStress && loadedStressDict && (
        <Text as="p" type="supporting">
          {t(
            "Stress and intonation marks are auto-generated from a pronunciation dictionary and simple rules. They may be wrong.",
          )}
        </Text>
      )}
      {mode === "shadow" && !pronunciationSupported && (
        <Text as="p" type="supporting">
          {t("Pronunciation check disabled: speech recognition is not supported in this browser.")}
        </Text>
      )}
      {mode === "shadow" && disclosureOpen && (
        <Card padding={3} xstyle={sharedStyles.sentence}>
          <VStack gap={1}>
            <Text as="p">
              {t(
                "Pronunciation check uses your browser's speech recognition. In Chrome, your voice may be sent to Google's servers to be transcribed unless the browser recognises it on this device. Nothing is sent to road-to-english.",
              )}
            </Text>
            <HStack gap={1}>
              <Button
                ref={takeDisclosureFocus("enable")}
                label={t("Enable")}
                variant="primary"
                onClick={() => {
                  writePref(PRONUNCIATION_CHECK_KEY, "on");
                  setPronunciationCheck(true);
                  disclosureFocus.current = "display";
                  setDisclosureOpen(false);
                }}
              />
              <Button
                label={t("Cancel")}
                variant="ghost"
                onClick={() => {
                  disclosureFocus.current = "display";
                  setDisclosureOpen(false);
                }}
              />
            </HStack>
          </VStack>
        </Card>
      )}
      {guidedIndex !== null ? (
        <div className={stylex.props(learnGuided && styles.learnLayout).className}>
          <GuidedShadowing
            index={guidedIndex}
            count={data.sentences.length}
            step={(index) => {
              stopMedia();
              setGuidedIndex(index);
            }}
            gate={{
              available: learnAvailable,
              on: learnOn,
              setOn: setLearn,
              skipsLeft: SKIPS_PER_LESSON - skipsUsed,
              progressCount: learnProgress.passed.length,
              startOver: () => setLearnProgress(EMPTY_LEARN_PROGRESS),
            }}
          >
            {(go) =>
              learnOn ? (
                <LearnSentence
                  key={data.sentences[guidedIndex].id}
                  lesson={data}
                  index={guidedIndex}
                  go={go}
                  speed={speed}
                  setSpeed={(next) => setSpeed(next as (typeof SPEEDS)[number])}
                  speeds={SPEEDS}
                  passed={passedIds.has(data.sentences[guidedIndex].id)}
                  skipsLeft={SKIPS_PER_LESSON - skipsUsed}
                  showVietnamese={showVietnamese}
                  stressDict={showStress ? loadedStressDict : null}
                  stopMedia={stopMedia}
                  onChecked={(result) => {
                    const { id } = data.sentences[guidedIndex];
                    shadowPractice(id, "check");
                    setScores((current) => new Map(current).set(id, Math.max(result.score, current.get(id) ?? 0)));
                    if (result.passed) pass(id);
                  }}
                  onTyped={() => {
                    const { id } = data.sentences[guidedIndex];
                    practice(id, "dictation");
                    pass(id);
                  }}
                  onSkip={() => {
                    pass(data.sentences[guidedIndex].id, true);
                    go(guidedIndex + 1);
                  }}
                  savedCardIds={savedCardIds}
                  addCard={addCard}
                  removeCard={removeCard}
                  undoRemove={undoRemove}
                />
              ) : (
                // Keyed so a step to another sentence starts its practice afresh.
                <SentenceCard
                  key={data.sentences[guidedIndex].id}
                  sentence={data.sentences[guidedIndex]}
                  textHidden={hiddenText.has(data.sentences[guidedIndex].id)}
                  active={activeSentenceId === data.sentences[guidedIndex].id}
                  {...cardProps}
                />
              )
            }
          </GuidedShadowing>
          {learnGuided && (
            <LearnTranscript
              sentences={data.sentences}
              current={guidedIndex}
              passed={passedIds}
              scores={scores}
              showVietnamese={showVietnamese}
              onOpen={(index) => {
                stopMedia();
                setGuidedIndex(index);
              }}
            />
          )}
        </div>
      ) : (
        <VStack as="ol" gap={2} padding={0}>
          {data.sentences.map((sentence) => (
            <li key={sentence.id}>
              <SentenceCard
                key={sentence.id}
                sentence={sentence}
                textHidden={hiddenText.has(sentence.id)}
                active={activeSentenceId === sentence.id}
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
        <Status>{allAttempted && completed && t("Lesson complete.")}</Status>
      </VisuallyHidden>
    </VStack>
  );
}
