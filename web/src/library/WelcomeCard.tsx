import { useId, useRef, useState } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { sharedStyles } from "../components/styles";
import { DAILY_GOALS, GOAL_NAMES, type DailyGoal } from "../hooks/useDailyGoal";
import { LEVEL_FILTERS, type LevelFilter } from "../hooks/useLevelFilter";

const styles = stylex.create({
  todayCard: {
    padding: "0.75rem",
  },
});

// The first-run welcome: level, then daily goal. Choices apply at once; Done or Skip on either step ends it.
export function WelcomeCard({
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
