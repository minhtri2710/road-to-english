import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { Lesson, Level } from "../api/lessons";
import { ErrorMessage } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import { useLessons } from "../hooks/lessons";
import { DAILY_GOALS, type DailyGoal } from "../hooks/useDailyGoal";
import type { LessonRoute } from "../hooks/useLastLesson";
import { LEVEL_FILTERS, type LevelFilter } from "../hooks/useLevelFilter";
import { useWelcome } from "../hooks/useWelcome";
import { MAX_FREEZES } from "../lib/progress";

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
  todayCard: {
    padding: "0.75rem",
  },
  // One line down to 320px: the longest streak text and the freezes fit at this size.
  streakRow: {
    fontSize: "0.8125rem",
  },
  // Only the streak text: the freezes tooltip renders inside its row and must still wrap.
  nowrap: {
    whiteSpace: "nowrap",
  },
  // Seven equal columns fit a 320px screen without scrolling.
  week: {
    display: "grid",
    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
    gap: "0.25rem",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  day: {
    textAlign: "center",
    whiteSpace: "nowrap",
    fontSize: "0.8125rem",
    border: "1px solid transparent",
    borderRadius: "var(--radius-element)",
  },
  today: {
    borderColor: "var(--color-border)",
    fontWeight: 600,
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

const GOAL_NAMES: Record<DailyGoal, string> = { "5": "Light", "10": "Regular", "20": "Intense" };
const WEEKDAY_NAMES: Record<string, string> = {
  Sun: "Sunday",
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
};
const FREEZE_HELP = `A freeze keeps your streak when you miss one day. You earn one for every 7 days in a row, up to ${MAX_FREEZES}.`;

// The first-run welcome: level, then daily goal. Choices apply at once; Done or Skip on either step ends it.
function WelcomeCard({
  levelFilter,
  chooseLevelFilter,
  dailyGoal,
  chooseGoal,
  onFinish,
}: {
  levelFilter: LevelFilter;
  chooseLevelFilter: (filter: LevelFilter) => void;
  dailyGoal: DailyGoal;
  chooseGoal: (goal: DailyGoal) => void;
  onFinish: () => void;
}) {
  const headingId = useId();
  const [step, setStep] = useState<1 | 2>(1);
  // Set by Next, so the step 2 question takes focus once as it mounts.
  const focusQuestion = useRef(false);
  return (
    <Card xstyle={[sharedStyles.sentence, styles.todayCard]}>
      <VStack as="section" gap={1} aria-labelledby={headingId}>
        <HStack gap={1} align="center" xstyle={sharedStyles.shadowingControls}>
          <Heading level={2} id={headingId}>Welcome to Road to English</Heading>
          <Text type="supporting">Step {step} of 2</Text>
        </HStack>
        {step === 1 ? (
          <>
            <Text as="p">What is your English level?</Text>
            <SegmentedControl
              label="English level"
              value={levelFilter}
              onChange={(filter) => chooseLevelFilter(filter as LevelFilter)}
            >
              {LEVEL_FILTERS.map((filter) => (
                <SegmentedControlItem key={filter} value={filter} label={filter === "All" ? "Not sure" : filter} />
              ))}
            </SegmentedControl>
          </>
        ) : (
          <>
            <Text
              as="p"
              tabIndex={-1}
              ref={(question) => {
                if (question && focusQuestion.current) {
                  focusQuestion.current = false;
                  question.focus();
                }
              }}
            >
              How much practice a day?
            </Text>
            <ToggleButtonGroup
              label="Daily goal"
              value={dailyGoal}
              onChange={(nextGoal) => {
                if (nextGoal) {
                  chooseGoal(nextGoal as DailyGoal);
                }
              }}
            >
              {DAILY_GOALS.map((value) => (
                <ToggleButton key={value} value={value} label={`${value} ${GOAL_NAMES[value]}`} />
              ))}
            </ToggleButtonGroup>
            <Text as="p" type="supporting">
              You can change both later: the level filter below the Today card and the goal in the Today card.
            </Text>
          </>
        )}
        <HStack gap={1} align="center">
          {step === 1 ? (
            <Button label="Next" variant="primary" onClick={() => {
                focusQuestion.current = true;
                setStep(2);
              }}
            />
          ) : (
            <Button label="Done" variant="primary" onClick={onFinish} />
          )}
          <Button label="Skip" variant="secondary" onClick={onFinish} />
        </HStack>
      </VStack>
    </Card>
  );
}

function TodayCard({
  headingRef,
  due,
  actionsToday,
  dailyGoal,
  goalMet,
  chooseGoal,
  streak,
  freezes,
  xp,
  week,
  suggestion,
  onReview,
}: {
  headingRef: (heading: HTMLHeadingElement | null) => void;
  due: number | null;
  actionsToday: number;
  dailyGoal: DailyGoal;
  goalMet: boolean;
  chooseGoal: (goal: DailyGoal) => void;
  streak: number;
  freezes: number;
  xp: number;
  week: { key: string; label: string; practiced: boolean }[];
  suggestion: { text: string; action: string; onOpen: () => void } | undefined;
  onReview: () => void;
}) {
  const cards = (count: number) => `${count} card${count === 1 ? "" : "s"}`;
  // With no card due, the suggestion shares the due line: "0 cards due · Next: About Me".
  const dueLine = [due !== null && `${cards(due)} due`, !due && suggestion?.text].filter(Boolean).join(" · ");
  const today = week.at(-1)?.key;
  return (
    <Card xstyle={[sharedStyles.sentence, styles.todayCard]}>
      <VStack gap={1}>
        <HStack gap={1} align="center" xstyle={sharedStyles.shadowingControls}>
          <Heading level={2} tabIndex={-1} ref={headingRef}>Today</Heading>
          {dueLine && <Text type="supporting">{dueLine}</Text>}
          {due ? (
            <Button label={`Review ${cards(due)}`} variant="primary" onClick={onReview} />
          ) : (
            suggestion && <Button label={suggestion.action} variant="primary" onClick={suggestion.onOpen} />
          )}
        </HStack>
        <ProgressBar
          label={`${actionsToday} of ${dailyGoal} practice actions today${goalMet ? " · Daily goal met" : ""}`}
          value={Math.min(actionsToday, Number(dailyGoal))}
          max={Number(dailyGoal)}
        />
        <ToggleButtonGroup
          label="Daily goal"
          value={dailyGoal}
          onChange={(nextGoal) => {
            if (nextGoal) {
              chooseGoal(nextGoal as DailyGoal);
            }
          }}
        >
          {DAILY_GOALS.map((value) => (
            <ToggleButton key={value} value={value} label={`${value} ${GOAL_NAMES[value]}`} />
          ))}
        </ToggleButtonGroup>
        <HStack gap={1} align="center" xstyle={styles.streakRow}>
          <Text weight="semibold" xstyle={styles.nowrap}>{streak > 0 ? `${streak}-day streak` : "Start a new streak today"}</Text>
          <Text type="supporting">
            <Tooltip content={FREEZE_HELP}>{`Freezes ${freezes} of ${MAX_FREEZES}`}</Tooltip>
          </Text>
        </HStack>
        <ul aria-label="This week" className={stylex.props(styles.week).className}>
          {week.map((day) => (
            <li
              key={day.key}
              aria-current={day.key === today ? "date" : undefined}
              className={stylex.props(styles.day, day.key === today && styles.today).className}
            >
              <span aria-hidden="true">
                {day.label.slice(0, 2)} {day.practiced ? "✓" : "·"}
              </span>
              <VisuallyHidden>
                {WEEKDAY_NAMES[day.label]} {day.practiced ? "practised" : "not practised"}
              </VisuallyHidden>
            </li>
          ))}
        </ul>
        <Text type="supporting">{xp} XP</Text>
      </VStack>
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
