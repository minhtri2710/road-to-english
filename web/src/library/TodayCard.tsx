import { useId } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { sharedStyles } from "../components/styles";
import { DAILY_GOALS, GOAL_NAMES, type DailyGoal } from "../hooks/useDailyGoal";
import { MAX_FREEZES } from "../lib/progress";

const styles = stylex.create({
  todayCard: {
    padding: "0.75rem",
  },
  // One line down to 320px: the longest streak text and the freezes fit at this size.
  // Larger text wraps rather than overflowing the card.
  streakRow: {
    fontSize: "0.8125rem",
    flexWrap: "wrap",
  },
  tooltipTarget: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "1.5rem",
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

export function TodayCard({
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
  // Its text names the lesson, so it describes the Continue or Start lesson button.
  const dueText = due !== null ? `${cards(due)} due` : null;
  const suggestionText = due ? undefined : suggestion?.text;
  const suggestionId = useId();
  const today = week.at(-1)?.key;
  return (
    <Card xstyle={[sharedStyles.sentence, styles.todayCard]}>
      <VStack gap={1}>
        <HStack gap={1} align="center" xstyle={sharedStyles.shadowingControls}>
          <Heading level={2} tabIndex={-1} ref={headingRef}>Today</Heading>
          {(dueText || suggestionText) && (
            <Text type="supporting">
              {dueText}
              {dueText && suggestionText && " · "}
              {suggestionText && <span id={suggestionId}>{suggestionText}</span>}
            </Text>
          )}
          {due ? (
            <Button label={`Review ${cards(due)}`} variant="primary" onClick={onReview} />
          ) : (
            suggestion && (
              <Button label={suggestion.action} aria-describedby={suggestionId} variant="primary" onClick={suggestion.onOpen} />
            )
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
          <Text weight="semibold">{streak > 0 ? `${streak}-day streak` : "Start a new streak today"}</Text>
          <Text type="supporting">
            <Tooltip content={FREEZE_HELP}>
              {/* The focusable trigger keeps the 24px minimum target size. */}
              <span tabIndex={0} className={stylex.props(styles.tooltipTarget).className}>
                {`Freezes ${freezes} of ${MAX_FREEZES}`}
              </span>
            </Tooltip>
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
