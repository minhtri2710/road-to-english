import { useId } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { sharedStyles } from "../components/styles";
import { DAILY_GOALS, GOAL_NAMES, type DailyGoal } from "../hooks/useDailyGoal";
import { useT } from "../i18n";
import { MAX_FREEZES } from "../lib/progress";
import { GoalRing } from "./GoalRing";

const styles = stylex.create({
  todayCard: {
    padding: { default: "var(--spacing-5)", "@media (max-width: 480px)": "var(--spacing-2)" },
  },
  todayContent: {
    gap: { default: "var(--spacing-3)", "@media (max-width: 480px)": "var(--spacing-0-5)" },
  },
  // The title row: Today on the left, the XP total at the end.
  titleRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "var(--spacing-2)",
  },
  // The next step, as a highlighted block with its button, like a learning app's "continue" card.
  next: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--spacing-1) var(--spacing-3)",
    // Phones show it as a plain row, keeping the first lesson inside the first screen.
    padding: { default: "var(--spacing-3)", "@media (max-width: 480px)": 0 },
    borderRadius: "var(--radius-element)",
    backgroundColor: { default: "var(--color-accent-muted)", "@media (max-width: 480px)": "transparent" },
  },
  nextText: {
    flex: "1 1 10rem",
    minWidth: 0,
  },
  // Phones drop the rule to keep the first lesson inside the first screen.
  divider: {
    paddingBlockStart: { default: "var(--spacing-3)", "@media (max-width: 480px)": 0 },
    borderBlockStartWidth: { default: "1px", "@media (max-width: 480px)": 0 },
    borderBlockStartStyle: "solid",
    borderBlockStartColor: "var(--color-border)",
  },
  // One line down to 320px: the longest streak text and the freezes fit at this size.
  // Larger text wraps rather than overflowing the card.
  streakRow: {
    fontSize: "var(--font-size-sm)",
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
    gap: "var(--spacing-1)",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  goalRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-1)",
  },
  goalDetails: {
    minWidth: 0,
    flex: "1 1 auto",
  },
  goalPicker: {
    flexWrap: "wrap",
    gap: "var(--spacing-0-5)",
  },
  goalText: {
    fontVariantNumeric: "tabular-nums",
  },
  day: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "var(--spacing-0-5)",
    minWidth: 0,
    minHeight: "1.5rem",
    paddingInline: "var(--spacing-0-5)",
    textAlign: "center",
    whiteSpace: "nowrap",
    fontSize: "var(--font-size-sm)",
    border: "var(--border-width) solid var(--color-border)",
    borderRadius: "var(--radius-element)",
  },
  practised: {
    backgroundColor: "var(--color-success-muted)",
  },
  today: {
    outline: "2px solid var(--color-accent)",
    outlineOffset: "2px",
    fontWeight: "var(--font-weight-semibold)",
  },
  dayCheck: {
    color: "var(--color-success)",
    fontWeight: "var(--font-weight-bold)",
  },
  statRow: {
    flexWrap: "wrap",
    fontVariantNumeric: "tabular-nums",
  },
  xp: {
    fontFamily: "var(--rte-font-mono)",
    fontVariantNumeric: "tabular-nums",
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
  const t = useT();
  // With no card due, the suggestion shares the due line: "0 cards due · Next: About Me".
  // Its text names the lesson, so it describes the Continue or Start lesson button.
  const dueText = due !== null ? t(due === 1 ? "{count} card due" : "{count} cards due", { count: due }) : null;
  const suggestionText = due ? undefined : suggestion?.text;
  const suggestionId = useId();
  const today = week.at(-1)?.key;
  return (
    <Card xstyle={[sharedStyles.sentence, styles.todayCard]}>
      <VStack xstyle={styles.todayContent}>
        <div className={stylex.props(styles.titleRow).className}>
          <Heading level={2} tabIndex={-1} ref={headingRef}>{t("Today")}</Heading>
          <Text type="supporting" xstyle={styles.xp}>{t("{xp} XP", { xp })}</Text>
        </div>
        {(dueText || suggestionText || due || suggestion) && (
          <div className={stylex.props(styles.next).className}>
            {(dueText || suggestionText) && (
              <Text type="supporting" xstyle={styles.nextText}>
                {dueText}
                {dueText && suggestionText && " · "}
                {suggestionText && <span id={suggestionId}>{suggestionText}</span>}
              </Text>
            )}
            {due ? (
              <Button label={t(due === 1 ? "Review {count} card" : "Review {count} cards", { count: due })} variant="primary" onClick={onReview} />
            ) : (
              suggestion && (
                <Button label={suggestion.action} aria-describedby={suggestionId} variant="primary" onClick={suggestion.onOpen} />
              )
            )}
          </div>
        )}
        <div className={stylex.props(styles.goalRow).className}>
          <GoalRing
            label={`${t("{done} of {goal} practice actions today", { done: actionsToday, goal: dailyGoal })}${goalMet ? ` · ${t("Daily goal met")}` : ""}`}
            value={actionsToday}
            max={Number(dailyGoal)}
            goalMet={goalMet}
          />
          <VStack xstyle={[styles.goalDetails, styles.goalText]}>
            <Text>{t("{done} of {goal} practice actions today", { done: actionsToday, goal: dailyGoal })}</Text>
            {goalMet && <Text weight="semibold">{t("Daily goal met")}</Text>}
            <ToggleButtonGroup
              label={t("Daily goal")}
              value={dailyGoal}
              xstyle={styles.goalPicker}
              onChange={(nextGoal) => {
                if (nextGoal) {
                  chooseGoal(nextGoal as DailyGoal);
                }
              }}
            >
              {DAILY_GOALS.map((value) => (
                <ToggleButton key={value} value={value} label={`${value} ${t(GOAL_NAMES[value])}`} size="sm" />
              ))}
            </ToggleButtonGroup>
          </VStack>
        </div>
        <VStack gap={1} xstyle={styles.divider}>
          <HStack gap={2} align="center" xstyle={[styles.streakRow, styles.statRow]}>
            <Text weight="semibold">{streak > 0 ? t("{streak}-day streak", { streak }) : t("Start a new streak today")}</Text>
            <Text type="supporting">
              <Tooltip
                content={t(
                  "A freeze keeps your streak when you miss one day. You earn one for every 7 days in a row, up to {max}.",
                  { max: MAX_FREEZES },
                )}
              >
                {/* The focusable trigger keeps the 24px minimum target size. */}
                <span tabIndex={0} className={stylex.props(styles.tooltipTarget).className}>
                  {t("Freezes {freezes} of {max}", { freezes, max: MAX_FREEZES })}
                </span>
              </Tooltip>
            </Text>
          </HStack>
          <ul aria-label={t("This week")} className={stylex.props(styles.week).className}>
            {week.map((day) => (
              <li
                key={day.key}
                aria-current={day.key === today ? "date" : undefined}
                className={stylex.props(styles.day, day.practiced && styles.practised, day.key === today && styles.today).className}
              >
                <span aria-hidden="true">{t(day.label.slice(0, 2))}</span>
                <span aria-hidden="true" className={stylex.props(day.practiced && styles.dayCheck).className}>{day.practiced ? "✓" : "○"}</span>
                <VisuallyHidden>
                  {t(day.practiced ? "{day} practised" : "{day} not practised", { day: t(WEEKDAY_NAMES[day.label]) })}
                </VisuallyHidden>
              </li>
            ))}
          </ul>
        </VStack>
      </VStack>
    </Card>
  );
}
