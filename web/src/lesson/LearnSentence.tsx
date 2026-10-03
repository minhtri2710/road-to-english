import { useState } from "react";

import { VStack } from "@astryxdesign/core/VStack";

import type { Lesson } from "../api/lessons";
import type { StopMedia } from "../hooks/usePracticeMedia";
import { useT } from "../i18n";
import type { ShadowScore } from "../lib/shadowScore";
import { speak } from "../lib/speech";
import type { StressDict } from "../lib/stress";
import { wordCard, type NewCard, type VocabCard } from "../lib/vocab";
import { cardWord } from "../lib/words";
import { SKIPS_PER_LESSON } from "./GuidedShadowing";
import { LearnStage } from "./LearnView";
import { ShadowGate } from "./ShadowGate";
import { SentenceWords, WordPanel } from "./WordPanel";

// One sentence in Learn mode: the stage with its caption (the video is the stage of a video lesson), a word's
// card when one is tapped, and the shadow bar that scores the sentence and unlocks the next.
export function LearnSentence({
  lesson,
  index,
  go,
  speed,
  setSpeed,
  speeds,
  passed,
  skipsLeft,
  showVietnamese,
  stressDict,
  stopMedia,
  onChecked,
  onTyped,
  onSkip,
  savedCardIds,
  addCard,
  removeCard,
  undoRemove,
}: {
  lesson: Lesson;
  index: number;
  go: (index: number) => void;
  speed: string;
  setSpeed: (speed: string) => void;
  speeds: readonly string[];
  passed: boolean;
  skipsLeft: number;
  showVietnamese: boolean;
  stressDict: StressDict | null;
  stopMedia: StopMedia;
  onChecked: (result: ShadowScore) => void;
  onTyped: () => void;
  onSkip: () => void;
  savedCardIds: Set<string>;
  addCard: (input: NewCard) => Promise<void>;
  removeCard: (id: string) => Promise<VocabCard>;
  undoRemove: (tombstone: VocabCard) => Promise<boolean>;
}) {
  const t = useT();
  const sentence = lesson.sentences[index];
  const count = lesson.sentences.length;
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const panelId = `learn-word-panel-${sentence.id}`;

  return (
    <VStack gap={2}>
      {!lesson.videoId && (
        <LearnStage
          position={t("Sentence {n} of {count}", { n: index + 1, count })}
          speeds={speeds}
          speed={speed}
          setSpeed={setSpeed}
          vi={showVietnamese ? sentence.vi : null}
        >
          <SentenceWords
            text={sentence.text}
            panelId={panelId}
            selected={selectedWord}
            spokenChar={null}
            onSelect={setSelectedWord}
            stressDict={stressDict}
          />
        </LearnStage>
      )}
      {lesson.videoId && (
        <SentenceWords
          text={sentence.text}
          panelId={panelId}
          selected={selectedWord}
          spokenChar={null}
          onSelect={setSelectedWord}
          stressDict={stressDict}
        />
      )}
      {selectedWord && (
        <WordPanel
          key={cardWord(selectedWord)}
          id={panelId}
          text={selectedWord}
          card={wordCard(lesson.id, sentence, selectedWord)}
          savedCardIds={savedCardIds}
          addCard={addCard}
          removeCard={removeCard}
          undoRemove={undoRemove}
          hear={() => {
            stopMedia();
            speak(selectedWord, lesson.targetWpm, Number(speed));
          }}
        />
      )}
      <ShadowGate
        text={sentence.text}
        targetWpm={lesson.targetWpm}
        speed={Number(speed)}
        passed={passed}
        stopMedia={stopMedia}
        onChecked={onChecked}
        onTyped={onTyped}
        nav={{
          first: index === 0,
          last: index === count - 1,
          skipsLeft,
          skipsTotal: SKIPS_PER_LESSON,
          previous: () => go(index - 1),
          next: () => go(index + 1),
          skip: onSkip,
        }}
      />
    </VStack>
  );
}
