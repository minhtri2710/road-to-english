import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { Lesson } from "../api/lessons";
import { Alert, ErrorMessage } from "../components/feedback";
import { LessonRow } from "./LessonList";

export function UserLessonList({
  lessons,
  onSelect,
  onDelete,
  deleteFailedId,
  completedLessons,
  takeFocus,
}: {
  lessons: Lesson[] | Error | null;
  onSelect: (lesson: Lesson) => void;
  onDelete: (lesson: Lesson) => void;
  deleteFailedId: string | null;
  completedLessons: Set<string>;
  takeFocus: (id: string) => boolean;
}) {
  if (lessons === null) {
    return <Text as="p">Loading your lessons...</Text>;
  }

  if (lessons instanceof Error) {
    return <ErrorMessage error={lessons} subject="your lessons" />;
  }

  if (lessons.length === 0) {
    return <Text as="p">No lessons of your own yet.</Text>;
  }

  return (
    <VStack as="ul" gap={2} padding={0}>
      {lessons.map((lesson) => (
        <li key={lesson.id}>
          <HStack gap={1} align="center">
            <LessonRow
              title={lesson.title}
              level={lesson.level}
              sentenceCount={lesson.sentences.length}
              targetWpm={lesson.targetWpm}
              completed={completedLessons.has(lesson.id)}
              onSelect={() => onSelect(lesson)}
              takeFocus={() => takeFocus(lesson.id)}
            />
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
