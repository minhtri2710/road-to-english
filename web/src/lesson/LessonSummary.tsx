import { useRef } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { Lesson } from "../api/lessons";
import { Alert } from "../components/feedback";
import { useLessons } from "../hooks/lessons";
import { filterByLevel, type LevelFilter } from "../hooks/useLevelFilter";
import { cardId, type NewCard, type VocabCard } from "../lib/vocab";
import { SaveToReview } from "./WordPanel";

// The list the learner came from: the library under its level filter, or their own lessons.
export type LessonSource = { view: "lesson"; levelFilter: LevelFilter } | { view: "my"; lessons: Lesson[] };

export interface SummaryProps {
  // Cards due now as the Today card counts them, or null while unknown.
  due: number | null;
  onReview: () => void;
  source: LessonSource;
  openLesson: (id: string) => void;
}

export function LessonSummary({
  lessonId,
  sentenceCount,
  saveFailed,
  retrySave,
  onBack,
  missed,
  savedCardIds,
  addCard,
  removeCard,
  undoRemove,
  due,
  onReview,
  source,
  openLesson,
}: SummaryProps & {
  lessonId: string;
  sentenceCount: number;
  saveFailed: boolean;
  // Resolves to whether the save succeeded.
  retrySave: () => Promise<boolean>;
  onBack: () => void;
  // Word cards for the words missed this visit.
  missed: readonly NewCard[];
  savedCardIds: Set<string>;
  addCard: (input: NewCard) => Promise<void>;
  removeCard: (id: string) => Promise<VocabCard>;
  undoRemove: (tombstone: VocabCard) => Promise<boolean>;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <VStack as="section" gap={2} aria-labelledby="lesson-summary">
      <Heading id="lesson-summary" level={2} ref={heading} tabIndex={-1}>
        Lesson complete
      </Heading>
      <Text as="p">You practised all {sentenceCount} sentences.</Text>
      {saveFailed && (
        <VStack gap={1}>
          <Alert>Couldn't save your progress.</Alert>
          {/* A successful retry removes Try again, so focus moves to the heading. */}
          <Button
            label="Try again"
            variant="secondary"
            onClick={() => void retrySave().then((saved) => saved && heading.current?.focus())}
          />
        </VStack>
      )}
      {missed.length > 0 && (
        <VStack gap={1}>
          <Heading id="missed-words" level={3}>
            Missed words
          </Heading>
          <VStack as="ul" gap={1} aria-labelledby="missed-words">
            {missed.map((card) => (
              <li key={card.source.word}>
                <HStack gap={1} align="center">
                  <Text weight="semibold">{card.front}</Text>
                  <SaveToReview
                    card={card}
                    label="Save"
                    word={card.front}
                    saved={savedCardIds.has(cardId(card.source))}
                    addCard={addCard}
                    removeCard={removeCard}
                    undoRemove={undoRemove}
                  />
                </HStack>
              </li>
            ))}
          </VStack>
        </VStack>
      )}
      {due !== null && due > 0 && (
        <HStack gap={1} align="center">
          <Text as="p">
            {due} {due === 1 ? "card" : "cards"} due now.
          </Text>
          <Button label="Review now" variant="secondary" onClick={onReview} />
        </HStack>
      )}
      <HStack gap={1}>
        {source.view === "lesson" ? (
          <LibraryNextLesson lessonId={lessonId} levelFilter={source.levelFilter} openLesson={openLesson} />
        ) : (
          <NextLesson lessonId={lessonId} lessons={source.lessons} openLesson={openLesson} />
        )}
        <Button label="Back to lessons" variant="ghost" onClick={onBack} />
      </HStack>
    </VStack>
  );
}

function LibraryNextLesson({
  lessonId,
  levelFilter,
  openLesson,
}: {
  lessonId: string;
  levelFilter: LevelFilter;
  openLesson: (id: string) => void;
}) {
  const { data } = useLessons();
  const shown = filterByLevel(data, levelFilter);
  return <NextLesson lessonId={lessonId} lessons={shown ?? []} openLesson={openLesson} />;
}

// The lesson after this one in the list, if any.
function NextLesson({
  lessonId,
  lessons,
  openLesson,
}: {
  lessonId: string;
  lessons: { id: string; title: string }[];
  openLesson: (id: string) => void;
}) {
  const index = lessons.findIndex((lesson) => lesson.id === lessonId);
  const next = index === -1 ? undefined : lessons[index + 1];
  if (!next) {
    return null;
  }
  return <Button label={`Next lesson: ${next.title}`} variant="primary" onClick={() => openLesson(next.id)} />;
}
