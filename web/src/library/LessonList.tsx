import { useEffect, type ReactNode } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { Lesson, Level } from "../api/lessons";
import { ErrorMessage } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import { useLessons } from "../hooks/lessons";
import type { DailyGoal } from "../hooks/useDailyGoal";
import type { LessonRoute } from "../hooks/useLastLesson";
import { LEVEL_FILTERS, type LevelFilter } from "../hooks/useLevelFilter";

const styles = stylex.create({
  lessonButton: {
    width: "100%",
    justifyContent: "space-between",
    textAlign: "start",
    // The row grows to its two-line content; badges wrap below the title when space runs out.
    height: "auto",
    paddingBlock: "0.5rem",
    whiteSpace: "normal",
  },
  lessonRowContent: {
    flexWrap: "wrap",
  },
});

export function LessonRow({
  title,
  level,
  sentenceCount,
  targetWpm,
  completed,
  onSelect,
  takeFocus,
}: {
  title: string;
  level: Level;
  sentenceCount: number;
  targetWpm: number;
  completed: boolean;
  onSelect: () => void;
  takeFocus: () => boolean;
}) {
  return (
    <Button
      ref={(button) => {
        if (button && takeFocus()) {
          button.focus();
        }
      }}
      label={title}
      variant="secondary"
      xstyle={styles.lessonButton}
      onClick={onSelect}
    >
      <HStack justify="between" align="center" width="100%" xstyle={styles.lessonRowContent}>
        <VStack gap={0.5} align="start">
          <Text weight="semibold">{title}</Text>
          <Text type="supporting">
            {level} · {sentenceCount} sentences
          </Text>
        </VStack>
        <HStack gap={1} align="center">
          <Badge label={`${targetWpm} WPM`} variant="info" />
          {completed && <Badge label="Completed" variant="success" />}
        </HStack>
      </HStack>
    </Button>
  );
}

function TodayStrip({
  due,
  actionsToday,
  dailyGoal,
  suggestion,
  onReview,
}: {
  due: number | null;
  actionsToday: number;
  dailyGoal: DailyGoal;
  suggestion: { text: string; action: string; onOpen: () => void } | undefined;
  onReview: () => void;
}) {
  const cards = (count: number) => `${count} card${count === 1 ? "" : "s"}`;
  return (
    <Card padding={2} xstyle={sharedStyles.sentence}>
      <HStack gap={1} align="center" xstyle={sharedStyles.shadowingControls}>
        <Heading level={2}>Today</Heading>
        <Text type="supporting">
          {due !== null && `${cards(due)} due · `}Goal {actionsToday}/{dailyGoal}
        </Text>
        {due ? (
          <Button label={`Review ${cards(due)}`} variant="primary" onClick={onReview} />
        ) : (
          suggestion && (
            <>
              <Text type="supporting">{suggestion.text}</Text>
              <Button label={suggestion.action} variant="primary" onClick={suggestion.onOpen} />
            </>
          )
        )}
      </HStack>
    </Card>
  );
}

export function LessonList({
  onSelect,
  completedLessons,
  takeFocus,
  focusHeading,
  onSettled,
  levelFilter,
  chooseLevelFilter,
  lastLesson,
  ownLessons,
  onContinue,
  today,
}: {
  onSelect: (id: string) => void;
  completedLessons: Set<string>;
  takeFocus: (id: string) => boolean;
  focusHeading: () => void;
  onSettled: (settled: boolean) => void;
  levelFilter: LevelFilter;
  chooseLevelFilter: (filter: LevelFilter) => void;
  lastLesson: LessonRoute | null;
  ownLessons: Lesson[];
  onContinue: () => void;
  today: Omit<Parameters<typeof TodayStrip>[0], "suggestion">;
}) {
  const { data, loading, error, retry } = useLessons();
  // Rows take the return focus as they mount, so this runs after any row could have taken it.
  useEffect(() => {
    onSettled(!loading);
    return () => onSettled(false);
  }, [loading]);
  const shown = levelFilter === "All" ? data : data?.filter((lesson) => lesson.level === levelFilter);
  const unfinished = (lesson: { id: string }) => !completedLessons.has(lesson.id);
  // The last opened lesson while it still exists unfinished, else the first unfinished library lesson in the level.
  const lastPool: { id: string; title: string }[] | undefined = lastLesson?.view === "lesson" ? data ?? undefined : ownLessons;
  const continueLesson = lastLesson && lastPool?.find((lesson) => lesson.id === lastLesson.id && unfinished(lesson));
  const nextLesson = shown?.find(unfinished);
  const completedCount = shown?.filter((lesson) => !unfinished(lesson)).length ?? 0;
  const suggestion = continueLesson
    ? { text: `Continue: ${continueLesson.title}`, action: "Continue", onOpen: onContinue }
    : nextLesson && { text: `Next: ${nextLesson.title}`, action: "Start lesson", onOpen: () => onSelect(nextLesson.id) };

  let content: ReactNode;
  if (loading) {
    content = <Text as="p">Loading lessons...</Text>;
  } else if (error) {
    content = (
      <VStack gap={1}>
        <ErrorMessage error={error} subject="lessons" />
        <Text as="p" type="supporting">
          Your own lessons below still work offline.
        </Text>
        <Button
          label="Retry"
          variant="secondary"
          xstyle={sharedStyles.viewToggle}
          onClick={() => {
            // Retry unmounts into the loading line, so focus moves to the view's h1 in the same render.
            focusHeading();
            retry();
          }}
        />
      </VStack>
    );
  } else if (!data || data.length === 0 || !shown) {
    content = <Text as="p">No lessons available.</Text>;
  } else if (shown.length === 0) {
    content = <Text as="p">No lessons at this level.</Text>;
  } else {
    content = (
      <VStack as="ul" gap={2} padding={0}>
        {shown.map((lesson) => (
          <li key={lesson.id}>
            <LessonRow
              title={lesson.title}
              level={lesson.level}
              sentenceCount={lesson.sentenceCount}
              targetWpm={lesson.targetWpm}
              completed={completedLessons.has(lesson.id)}
              onSelect={() => onSelect(lesson.id)}
              takeFocus={() => takeFocus(lesson.id)}
            />
          </li>
        ))}
      </VStack>
    );
  }

  return (
    <VStack gap={4}>
      <TodayStrip {...today} suggestion={suggestion} />
      <VStack gap={2}>
        <SegmentedControl
          label="Level"
          value={levelFilter}
          onChange={(filter) => chooseLevelFilter(filter as LevelFilter)}
        >
          {LEVEL_FILTERS.map((filter) => (
            <SegmentedControlItem key={filter} value={filter} label={filter} />
          ))}
        </SegmentedControl>
        {shown && shown.length > 0 && (
          <ProgressBar
            label={`${levelFilter === "All" ? "" : `${levelFilter}: `}${completedCount} of ${shown.length} completed`}
            value={completedCount}
            max={shown.length}
          />
        )}
      </VStack>
      {content}
    </VStack>
  );
}
