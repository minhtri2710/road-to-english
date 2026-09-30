import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { Lesson, Level } from "../api/lessons";
import { ErrorMessage } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import { useLessons } from "../hooks/lessons";
import type { LessonRoute } from "../hooks/useLastLesson";
import { filterByLevel, LEVEL_FILTERS, type LevelFilter } from "../hooks/useLevelFilter";
import { useWelcome } from "../hooks/useWelcome";
import { LessonCard } from "./LessonCard";
import { TodayCard } from "./TodayCard";
import { WelcomeCard } from "./WelcomeCard";

const LEVELS: Level[] = ["A1", "A2", "B1", "B2"];

const styles = stylex.create({
  levelFilter: {
    flexWrap: "wrap",
    maxWidth: "100%",
  },
  groupHeading: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "var(--spacing-1)",
  },
  groupCount: {
    flex: "0 0 auto",
    fontVariantNumeric: "tabular-nums",
  },
  progressRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
  },
  progressTrack: {
    flex: "1 1 auto",
    minWidth: "3rem",
    height: "3px",
    overflow: "hidden",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--color-background-muted)",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "var(--color-accent)",
    transitionProperty: "width",
    transitionDuration: "var(--duration-medium)",
    transitionTimingFunction: "var(--ease-standard)",
  },
});

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
  today: Omit<Parameters<typeof TodayCard>[0], "suggestion" | "headingRef">;
}) {
  const { welcomed, finishWelcome } = useWelcome();
  // Set by Done or Skip, so the Today card heading takes focus as it replaces the welcome.
  const focusToday = useRef(false);
  const { data, loading, error, retry } = useLessons();
  // Rows take the return focus as they mount, so this runs after any row could have taken it.
  useEffect(() => {
    onSettled(!loading);
    return () => onSettled(false);
  }, [loading]);
  const shown = filterByLevel(data, levelFilter);
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
    const groups = LEVELS.map((level) => ({
      level,
      lessons: shown.filter((lesson) => lesson.level === level),
    })).filter((group) => group.lessons.length > 0);
    content = (
      <VStack gap={3}>
        {groups.map(({ level, lessons }) => {
          const groupCompleted = lessons.filter((lesson) => completedLessons.has(lesson.id)).length;
          return (
            <section key={level} aria-labelledby={`library-level-${level}`}>
              <VStack gap={0.5}>
                <div className={stylex.props(styles.groupHeading).className}>
                  <Heading level={3} id={`library-level-${level}`}>{level}</Heading>
                  <Text type="supporting" xstyle={styles.groupCount}>{groupCompleted} of {lessons.length} completed</Text>
                </div>
                <VStack as="ul" gap={2} padding={0}>
                  {lessons.map((lesson) => (
                    <li key={lesson.id}>
                      <LessonCard
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
              </VStack>
            </section>
          );
        })}
      </VStack>
    );
  }

  return (
    <VStack gap={2}>
      {welcomed ? (
        <TodayCard
          {...today}
          suggestion={suggestion}
          headingRef={(heading) => {
            if (heading && focusToday.current) {
              focusToday.current = false;
              heading.focus();
            }
          }}
        />
      ) : (
        <WelcomeCard
          levelFilter={levelFilter}
          chooseLevelFilter={chooseLevelFilter}
          dailyGoal={today.dailyGoal}
          chooseGoal={today.chooseGoal}
          onFinish={() => {
            focusToday.current = true;
            finishWelcome();
          }}
        />
      )}
      <VStack gap={1}>
        <Heading level={2}>Library lessons</Heading>
        <SegmentedControl
          label="Library level"
          xstyle={styles.levelFilter}
          value={levelFilter}
          onChange={(filter) => chooseLevelFilter(filter as LevelFilter)}
        >
          {LEVEL_FILTERS.map((filter) => (
            <SegmentedControlItem key={filter} value={filter} label={filter} />
          ))}
        </SegmentedControl>
        {shown && shown.length > 0 && (
          <div className={stylex.props(styles.progressRow).className}>
            <Text type="supporting" id="library-overall-progress-text">{`${levelFilter === "All" ? "" : `${levelFilter}: `}${completedCount} of ${shown.length} completed`}</Text>
            <div
              role="progressbar"
              aria-labelledby="library-overall-progress-text"
              aria-valuemin={0}
              aria-valuenow={completedCount}
              aria-valuemax={shown.length}
              className={stylex.props(styles.progressTrack).className}
            >
              <div
                className={stylex.props(styles.progressFill).className}
                style={{ width: `${(completedCount / shown.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </VStack>
      {content}
    </VStack>
  );
}
