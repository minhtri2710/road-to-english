import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { Lesson } from "../api/lessons";
import { Alert, ErrorMessage } from "../components/feedback";
import { useT } from "../i18n";
import { LessonCard } from "./LessonCard";

const styles = stylex.create({
  // The same columns as the library's cards; one column on a narrow screen.
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 20rem), 1fr))",
    gap: "var(--spacing-4)",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  card: {
    flexGrow: 1,
    flexBasis: "8rem",
    minWidth: 0,
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
  const t = useT();
  if (lessons === null) {
    return <Text as="p">{t("Loading your lessons...")}</Text>;
  }

  if (lessons instanceof Error) {
    return <ErrorMessage error={lessons} subject={t("your lessons")} />;
  }

  if (lessons.length === 0) {
    return (
      <EmptyState
        title={t("No lessons of your own yet")}
        description={t("Paste a transcript or any English text to practise it as a lesson.")}
        isCompact
        actions={<Button label={t("Create a lesson")} variant="secondary" onClick={onCreateLesson} />}
      />
    );
  }

  return (
    <VStack gap={1}>
      {lessons.some((lesson) => lesson.videoId) && (
        <Text as="p" type="supporting">
          {t("Video lessons show their thumbnail from YouTube.")}
        </Text>
      )}
      <ul className={stylex.props(styles.grid).className}>
        {lessons.map((lesson) => (
          <li key={lesson.id}>
            <HStack gap={1} align="center" wrap="wrap">
              <div className={stylex.props(styles.card).className}>
                <LessonCard
                  videoId={lesson.videoId}
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
                label={t("Delete")}
                aria-label={t("Delete {title}", { title: lesson.title })}
                variant="ghost"
                onClick={() => onDelete(lesson)}
              />
            </HStack>
            {deleteFailedId === lesson.id && <Alert>{t("Couldn't delete. Try again.")}</Alert>}
          </li>
        ))}
      </ul>
    </VStack>
  );
}
