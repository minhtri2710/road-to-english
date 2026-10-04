import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { Lesson, Level } from "../api/lessons";
import { ErrorMessage, OfflineIcon } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import { useLessons } from "../hooks/lessons";
import type { LessonRoute } from "../hooks/useLastLesson";
import { filterByLevel, LEVEL_FILTERS, type LevelFilter } from "../hooks/useLevelFilter";
import { useWelcome } from "../hooks/useWelcome";
import { useT } from "../i18n";
import { LessonCard, levelTints } from "./LessonCard";
import { TodayCard } from "./TodayCard";
import { WelcomeCard } from "./WelcomeCard";

const LEVELS: Level[] = ["A1", "A2", "B1", "B2"];

// The CEFR name under each level's heading, as course catalogs label their levels.
const LEVEL_NAMES: Record<Level, string> = {
  A1: "Beginner",
  A2: "Elementary",
  B1: "Intermediate",
  B2: "Upper intermediate",
};

const styles = stylex.create({
  levelFilter: {
    flexWrap: "wrap",
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  // The design's hero: the library's title and intro, with Today beside it from laptop width.
  hero: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 1fr)", "@media (min-width: 960px)": "minmax(0, 1fr) minmax(0, 30rem)" },
    alignItems: "center",
    gap: { default: "var(--spacing-2)", "@media (min-width: 960px)": "var(--spacing-10)" },
    paddingBlockEnd: { default: 0, "@media (min-width: 481px)": "var(--spacing-6)" },
  },
  // A failed load sits in a panel the size of a lesson card's row, so the page keeps its shape.
  errorPanel: {
    alignItems: "flex-start",
    padding: "var(--spacing-4)",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: "var(--color-border)",
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-surface)",
  },
  // A level's header row: its tile, its name, and its progress at the end.
  groupHeading: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: { default: "var(--spacing-3)", "@media (max-width: 480px)": "var(--spacing-1) var(--spacing-2)" },
    // Phones keep the row to one line, so the first lesson stays inside the first screen.
    paddingBlockEnd: { default: "var(--spacing-3)", "@media (max-width: 480px)": 0 },
    marginBlockEnd: { default: "var(--spacing-1)", "@media (max-width: 480px)": 0 },
    borderBlockEndWidth: { default: "1px", "@media (max-width: 480px)": 0 },
    borderBlockEndStyle: "solid",
    borderBlockEndColor: "var(--color-border)",
  },
  levelTile: {
    flex: "0 0 auto",
    display: { default: "flex", "@media (max-width: 480px)": "none" },
    alignItems: "center",
    justifyContent: "center",
    width: "2.75rem",
    height: "2.75rem",
    borderRadius: "var(--radius-element)",
    fontFamily: "var(--rte-font-mono)",
    fontWeight: "var(--font-weight-bold)",
  },
  groupName: {
    flex: "1 1 auto",
    minWidth: 0,
    flexDirection: { default: "column", "@media (max-width: 480px)": "row" },
    alignItems: { default: "flex-start", "@media (max-width: 480px)": "baseline" },
    columnGap: "var(--spacing-1)",
    flexWrap: "wrap",
  },
  groupProgress: {
    flex: "0 1 12rem",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "var(--spacing-1)",
    minWidth: 0,
  },
  groupTrack: {
    display: { default: "block", "@media (max-width: 480px)": "none" },
    width: "100%",
    height: "4px",
    overflow: "hidden",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--color-background-muted)",
  },
  groupFill: {
    height: "100%",
    backgroundColor: "currentColor",
  },
  // Cards fill the library's width in columns; one column once a card would be narrower than 20rem.
  lessonGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 20rem), 1fr))",
    gap: "var(--spacing-4)",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  lessonItem: {
    display: "flex",
    minWidth: 0,
  },
  // The progress block takes the level color for its fill only, not a tinted background.
  groupTint: {
    backgroundColor: "transparent",
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
  intro,
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
  // The view's title and intro, laid out beside Today.
  intro: ReactNode;
}) {
  const t = useT();
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
    ? { text: t("Continue: {title}", { title: continueLesson.title }), action: t("Continue"), onOpen: onContinue }
    : nextLesson && { text: t("Next: {title}", { title: nextLesson.title }), action: t("Start lesson"), onOpen: () => onSelect(nextLesson.id) };

  let content: ReactNode;
  if (loading) {
    content = <Text as="p">{t("Loading lessons...")}</Text>;
  } else if (error) {
    content = (
      <VStack gap={1} xstyle={styles.errorPanel}>
        <HStack gap={1} align="center">
          <OfflineIcon />
          <Text weight="semibold">{t("Library lessons need the server")}</Text>
        </HStack>
        <ErrorMessage error={error} subject={t("lessons")} />
        <Text as="p" type="supporting">
          {t("Your own lessons below still work offline.")}
        </Text>
        <Button
          label={t("Retry")}
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
    content = <Text as="p">{t("No lessons available.")}</Text>;
  } else if (shown.length === 0) {
    content = <Text as="p">{t("No lessons at this level.")}</Text>;
  } else {
    const groups = LEVELS.map((level) => ({
      level,
      lessons: shown.filter((lesson) => lesson.level === level),
    })).filter((group) => group.lessons.length > 0);
    content = (
      <VStack gap={6}>
        {groups.map(({ level, lessons }) => {
          const groupCompleted = lessons.filter((lesson) => completedLessons.has(lesson.id)).length;
          return (
            <section key={level} aria-labelledby={`library-level-${level}`}>
              <VStack gap={2}>
                <div className={stylex.props(styles.groupHeading).className}>
                  <span aria-hidden="true" className={stylex.props(styles.levelTile, levelTints[level]).className}>{level}</span>
                  <VStack gap={0} xstyle={styles.groupName}>
                    <Heading level={3} id={`library-level-${level}`}>{level}</Heading>
                    <Text type="supporting">{t(LEVEL_NAMES[level])}</Text>
                  </VStack>
                  <div className={stylex.props(styles.groupProgress, levelTints[level], styles.groupTint).className}>
                    <Text type="supporting" xstyle={styles.groupCount}>{t("{done} of {total} completed", { done: groupCompleted, total: lessons.length })}</Text>
                    <span aria-hidden="true" className={stylex.props(styles.groupTrack).className}>
                      <span className={stylex.props(styles.groupFill).className} style={{ width: `${(groupCompleted / lessons.length) * 100}%` }} />
                    </span>
                  </div>
                </div>
                <ul className={stylex.props(styles.lessonGrid).className}>
                  {lessons.map((lesson) => (
                    <li key={lesson.id} className={stylex.props(styles.lessonItem).className}>
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
                </ul>
              </VStack>
            </section>
          );
        })}
      </VStack>
    );
  }

  return (
    <VStack gap={2}>
      <div className={stylex.props(styles.hero).className}>
        {intro}
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
      </div>
      <VStack gap={1}>
        <VStack gap={0.5}>
          <p aria-hidden="true" className={stylex.props(sharedStyles.eyebrow).className}>{t("Lessons")}</p>
          <Heading level={2} xstyle={sharedStyles.sectionTitle}>{t("Library lessons")}</Heading>
        </VStack>
        <SegmentedControl
          label={t("Library level")}
          xstyle={styles.levelFilter}
          value={levelFilter}
          onChange={(filter) => chooseLevelFilter(filter as LevelFilter)}
        >
          {LEVEL_FILTERS.map((filter) => (
            <SegmentedControlItem key={filter} value={filter} label={filter === "All" ? t("All") : filter} />
          ))}
        </SegmentedControl>
        {shown && shown.length > 0 && (
          <div className={stylex.props(styles.progressRow).className}>
            <Text type="supporting" id="library-overall-progress-text">{`${levelFilter === "All" ? "" : `${levelFilter}: `}${t("{done} of {total} completed", { done: completedCount, total: shown.length })}`}</Text>
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
