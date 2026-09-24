import { Button } from "@astryxdesign/core/Button";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
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
import { cardId, sentenceCard, wordCard, type NewCard, type VocabCard } from "../lib/vocab";
import { cardWord } from "../lib/words";
import { SentenceShadowing } from "./SentenceShadowing";
import { SentenceBlank, SentenceDictation } from "./SentenceQuiz";
import { SaveToReview, SentenceWords, WordPanel } from "./WordPanel";

const styles = stylex.create({
  modeToggle: {
    alignSelf: "start",
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
}: SentenceCardProps) {
  const showText = showTranscript && !textHidden;
  return (
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
          <ToggleButton
            label="Text"
            isPressed={!textHidden}
            xstyle={styles.modeToggle}
            onPressedChange={(pressed) => setTextHidden(sentence.id, !pressed)}
          />
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
  );
}
