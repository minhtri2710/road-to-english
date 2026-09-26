import { useId } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { Level } from "../api/lessons";

const styles = stylex.create({
  button: {
    width: "100%",
    minWidth: 0,
    height: "auto",
    justifyContent: "space-between",
    paddingBlock: "var(--spacing-2)",
    paddingInline: "var(--spacing-3)",
    textAlign: "start",
    whiteSpace: "normal",
    backgroundColor: "var(--color-background-surface)",
    color: "var(--color-text-primary)",
    boxShadow: "var(--shadow-low)",
    borderInlineStartWidth: "4px",
    borderInlineStartStyle: "solid",
    flexWrap: "wrap",
  },
  titleAndMeta: {
    minWidth: 0,
  },
  levelBadge: {
    alignSelf: "start",
    borderWidth: "1px",
    borderStyle: "solid",
    backgroundColor: "var(--color-background-surface)",
  },
  sentenceMeta: {
    fontVariantNumeric: "tabular-nums",
    display: "inline-flex",
    alignItems: "baseline",
  },
  badges: {
    flex: "0 0 auto",
    marginInlineStart: "auto",
  },
  completed: {
    color: "var(--color-success)",
    whiteSpace: "nowrap",
  },
  check: {
    fontWeight: "var(--font-weight-bold)",
  },
});

const levelStyles = stylex.create({
  A1: {
    color: "var(--rte-color-level-a1)",
    borderInlineStartColor: "var(--rte-color-level-a1)",
  },
  A2: {
    color: "var(--rte-color-level-a2)",
    borderInlineStartColor: "var(--rte-color-level-a2)",
  },
  B1: {
    color: "var(--rte-color-level-b1)",
    borderInlineStartColor: "var(--rte-color-level-b1)",
  },
  B2: {
    color: "var(--rte-color-level-b2)",
    borderInlineStartColor: "var(--rte-color-level-b2)",
  },
});

export function LessonCard({
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
  const metaId = useId();
  const wpmId = useId();
  const completedId = useId();
  return (
    <Button
      ref={(button) => {
        if (button && takeFocus()) button.focus();
      }}
      label={title}
      aria-describedby={completed ? `${metaId} ${wpmId} ${completedId}` : `${metaId} ${wpmId}`}
      variant="secondary"
      width="100%"
      xstyle={[styles.button, levelStyles[level]]}
      endContent={(
        <HStack gap={1} align="center" xstyle={styles.badges}>
          <Badge label={`${targetWpm} WPM`} variant="info" id={wpmId} />
          {completed && (
            <HStack gap={0.5} align="center" xstyle={styles.completed}>
              <span aria-hidden="true" className={stylex.props(styles.check).className}>✓</span>
              <Text type="supporting" weight="semibold" id={completedId}>Completed</Text>
            </HStack>
          )}
        </HStack>
      )}
      onClick={onSelect}
    >
      <VStack gap={0.5} align="start" xstyle={styles.titleAndMeta}>
        <Text weight="semibold">{title}</Text>
        <span id={metaId}>
          <HStack gap={1} align="center" xstyle={styles.sentenceMeta}>
            <Badge label={level} xstyle={[styles.levelBadge, levelStyles[level]]} />{" "}
            <Text type="supporting">· {sentenceCount} sentences</Text>
          </HStack>
        </span>
      </VStack>
    </Button>
  );
}
