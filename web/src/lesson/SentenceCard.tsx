import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { Lesson } from "../api/lessons";
import { sharedStyles } from "../components/styles";
import type { StopMedia } from "../hooks/usePracticeMedia";
import type { useYouTubePlayer } from "../hooks/useYouTubePlayer";
import type { PracticeMode } from "../lib/progress";
import { speak } from "../lib/speech";
import type { StressDict } from "../lib/stress";
import { cardId, sentenceCard, wordCard, type NewCard, type VocabCard } from "../lib/vocab";
import { cardWord } from "../lib/words";
import { SentenceShadowing } from "./SentenceShadowing";
import { SentenceBlank, SentenceDictation } from "./SentenceQuiz";
import { SaveToReview, SentenceWords, WordPanel } from "./WordPanel";
import { useT } from "../i18n";

const styles = stylex.create({
  // The sentence now playing, from Listen, Loop or its video clip.
  active: {
    boxShadow: "0 0 0 2px var(--color-accent)",
  },
  // The card's top row: the sentence's number, as the design's transcript timestamps, and the Text toggle.
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--spacing-2)",
  },
  number: {
    fontFamily: "var(--rte-font-mono)",
    fontSize: "0.75rem",
    fontWeight: "var(--font-weight-medium)",
    color: "var(--color-text-secondary)",
    fontVariantNumeric: "tabular-nums",
  },
  // Text-only buttons at a row's edge, shifted by their padding so their labels line up with the text.
  flushEnd: {
    marginInlineEnd: "calc(-1 * var(--spacing-3))",
  },
  flushStart: {
    alignSelf: "flex-start",
    marginInlineStart: "calc(-1 * var(--spacing-3))",
  },
});

const wordPanelId = (sentenceId: string) => `word-panel-${sentenceId}`;

export type LessonMode = "shadow" | "dictation" | "blank";

type Sentence = Lesson["sentences"][number];

interface SentenceCardProps {
  lesson: Lesson;
  sentence: Sentence;
  mode: LessonMode;
  speed: string;
  video: ReturnType<typeof useYouTubePlayer>;
  stopMedia: StopMedia;
  showTranscript: boolean;
  showVietnamese: boolean;
  // The loaded dictionary while stress marks are on, else null.
  stressDict: StressDict | null;
  textHidden: boolean;
  setTextHidden: (sentenceId: string, hidden: boolean) => void;
  selectedWord: { sentenceId: string; text: string } | null;
  setSelectedWord: (word: { sentenceId: string; text: string }) => void;
  spokenWord: { sentenceId: string; charIndex: number } | null;
  setSpokenWord: (spoken: { sentenceId: string; charIndex: number } | null) => void;
  loopingSentenceId: string | null;
  setLoopingSentenceId: (sentenceId: string | null) => void;
  pronunciationCheck: boolean;
  practice: (sentenceId: string, mode: PracticeMode) => void;
  shadowPractice: (sentenceId: string, mode: PracticeMode) => void;
  miss: (sentence: Sentence, words: string[]) => void;
  bankWords: string[] | undefined;
  savedCardIds: Set<string>;
  addCard: (input: NewCard) => Promise<void>;
  removeCard: (id: string) => Promise<VocabCard>;
  undoRemove: (tombstone: VocabCard) => Promise<boolean>;
  active: boolean;
  onPlayClip: (sentenceId: string) => void;
}

// One sentence's card, shared by the list and the guided view.
export function SentenceCard({
  lesson: data,
  sentence,
  mode,
  speed,
  video,
  stopMedia,
  showTranscript,
  showVietnamese,
  stressDict,
  textHidden,
  setTextHidden,
  selectedWord,
  setSelectedWord,
  spokenWord,
  setSpokenWord,
  loopingSentenceId,
  setLoopingSentenceId,
  pronunciationCheck,
  practice,
  shadowPractice,
  miss,
  bankWords,
  savedCardIds,
  addCard,
  removeCard,
  undoRemove,
  active,
  onPlayClip,
}: SentenceCardProps) {
  const t = useT();
  const showText = showTranscript && !textHidden;
  return (
    <Card padding={3} xstyle={[sharedStyles.sentence, active && styles.active]} data-active={active || undefined}>
      {sentence.cue && (
        <Button
          label={t("Play clip")}
          variant="secondary"
          isDisabled={video.status !== "ready"}
          onClick={() => {
            const { cue } = sentence;
            if (!cue) return;
            stopMedia({ keepVideo: true });
            video.playClip(cue, Number(speed));
            onPlayClip(sentence.id);
          }}
        />
      )}
      {mode === "shadow" ? (
        <VStack gap={1}>
          <div className={stylex.props(styles.header).className}>
            <span aria-hidden="true" className={stylex.props(styles.number).className}>
              {String(data.sentences.indexOf(sentence) + 1).padStart(2, "0")}
            </span>
            <Button
              label={t("Text")}
              variant="ghost"
              size="sm"
              xstyle={styles.flushEnd}
              aria-pressed={!textHidden}
              onClick={() => setTextHidden(sentence.id, !textHidden)}
            />
          </div>
          {showText && (
            <SentenceWords
              text={sentence.text}
              panelId={wordPanelId(sentence.id)}
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
              stressDict={stressDict}
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
              id={wordPanelId(sentence.id)}
              text={selectedWord.text}
              card={wordCard(data.id, sentence, selectedWord.text)}
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
            pronunciationCheck={pronunciationCheck}
            stopMedia={stopMedia}
          />
          <div className={stylex.props(styles.flushStart).className}>
            <SaveToReview
              card={sentenceCard(data.id, sentence)}
              label={t("Save to review")}
              saved={savedCardIds.has(cardId(sentenceCard(data.id, sentence).source))}
              addCard={addCard}
              removeCard={removeCard}
              undoRemove={undoRemove}
              compact
            />
          </div>
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
              miss={(words) => miss(sentence, words)}
              stopMedia={stopMedia}
            />
          ) : (
            <SentenceBlank
              id={sentence.id}
              text={sentence.text}
              targetWpm={data.targetWpm}
              speed={Number(speed)}
              practice={(practiceMode) => practice(sentence.id, practiceMode)}
              miss={(words) => miss(sentence, words)}
              stopMedia={stopMedia}
              lessonWords={bankWords}
            />
          )}
          <div className={stylex.props(styles.flushStart).className}>
            <SaveToReview
              card={sentenceCard(data.id, sentence)}
              label={t("Save to review")}
              saved={savedCardIds.has(cardId(sentenceCard(data.id, sentence).source))}
              addCard={addCard}
              removeCard={removeCard}
              undoRemove={undoRemove}
              compact
            />
          </div>
        </VStack>
      )}
    </Card>
  );
}
