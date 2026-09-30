import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { Lesson } from "../api/lessons";
import { Alert, ErrorMessage } from "../components/feedback";
import { LessonCard } from "./LessonCard";

const styles = stylex.create({
  card: {
    flexGrow: 1,
    flexBasis: "8rem",
  },
});

export function UserLessonList({
  lessons,
  onSelect,
  onDelete,
  deleteFailedId,
  completedLessons,
  takeFocus,
  onCreateLesson,
}: {
  lessons: Lesson[] | Error | null;
  onSelect: (lesson: Lesson) => void;
  onDelete: (lesson: Lesson) => void;
  deleteFailedId: string | null;
  completedLessons: Set<string>;
  takeFocus: (id: string) => boolean;
  onCreateLesson: () => void;
}) {
  if (lessons === null) {
    return <Text as="p">Loading your lessons...</Text>;
  }

  if (lessons instanceof Error) {
    return <ErrorMessage error={lessons} subject="your lessons" />;
  }

  if (lessons.length === 0) {
    return (
      <EmptyState
        title="No lessons of your own yet"
        description="Paste a transcript or any English text to practise it as a lesson."
        isCompact
        actions={<Button label="Create a lesson" variant="secondary" onClick={onCreateLesson} />}
      />
    );
  }

  return (
    <VStack as="ul" gap={2} padding={0}>
      {lessons.map((lesson) => (
        <li key={lesson.id}>
          <HStack gap={1} align="center" wrap="wrap">
            <div className={stylex.props(styles.card).className}>
              <LessonCard
                title={lesson.title}
                level={lesson.level}
                sentenceCount={lesson.sentences.length}
                targetWpm={lesson.targetWpm}
                completed={completedLessons.has(lesson.id)}
                onSelect={() => onSelect(lesson)}
                takeFocus={() => takeFocus(lesson.id)}
              />
            </div>
            <Button
              label="Delete"
              aria-label={`Delete ${lesson.title}`}
              variant="ghost"
              onClick={() => onDelete(lesson)}
            />
          </HStack>
          {deleteFailedId === lesson.id && <Alert>Couldn't delete. Try again.</Alert>}
        </li>
      ))}
    </VStack>
  );
}
