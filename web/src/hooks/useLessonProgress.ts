import { useEffect, useRef, useState } from "react";

import type { Lesson } from "../api/lessons";
import { wordCard, type NewCard } from "../lib/vocab";
import { cardWord, isCardWord } from "../lib/words";
import type { PracticeMode } from "../lesson/SentenceQuiz";

// Practice, missed words and the completion save for one lesson visit.
export function useLessonProgress(
  data: Lesson,
  completed: boolean,
  recordPractice: (options: { newCard: boolean }) => Promise<void>,
  markLessonComplete: (lessonId: string) => Promise<void>,
) {
  // Each sentence and mode counts once per lesson visit; retries are not counted.
  const practiced = useRef(new Set<string>());
  const hasPracticed = (sentenceId: string, mode: PracticeMode) => practiced.current.has(`${sentenceId}:${mode}`);
  // Sentences attempted in any mode this visit; attempting every one completes the lesson.
  const [attempted, setAttempted] = useState<ReadonlySet<string>>(new Set());
  const allAttempted = data.sentences.every((sentence) => attempted.has(sentence.id));
  const practice = (sentenceId: string, mode: PracticeMode) => {
    setAttempted((current) => (current.has(sentenceId) ? current : new Set(current).add(sentenceId)));
    const key = `${sentenceId}:${mode}`;
    if (practiced.current.has(key)) {
      return;
    }
    practiced.current.add(key);
    void recordPractice({ newCard: false });
  };
  // Card words missed in a typed answer this visit, in first-occurrence order, each under the sentence
  // where it was first missed.
  const [missed, setMissed] = useState<readonly NewCard[]>([]);
  const miss = (sentence: Lesson["sentences"][number], words: string[]) =>
    setMissed((current) => {
      const next = [...current];
      for (const word of words) {
        const key = cardWord(word);
        if (isCardWord(key) && !next.some((card) => card.source.word === key)) {
          next.push(wordCard(data.id, sentence, word));
        }
      }
      return next.length === current.length ? current : next;
    });

  // The save runs once per visit; a failure waits for Try again, and a lesson already complete is never saved again.
  const saveStarted = useRef(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const saveCompletion = () =>
    markLessonComplete(data.id).then(
      () => {
        setSaveFailed(false);
        return true;
      },
      () => {
        setSaveFailed(true);
        return false;
      },
    );
  useEffect(() => {
    if (allAttempted && !completed && !saveStarted.current) {
      saveStarted.current = true;
      void saveCompletion();
    }
  }, [allAttempted, completed]);

  return { hasPracticed, allAttempted, practice, missed, miss, saveFailed, saveCompletion };
}
