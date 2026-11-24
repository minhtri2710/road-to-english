import { useId, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { Level } from "../api/lessons";
import { useT } from "../i18n";

const styles = stylex.create({
  button: {
    width: "100%",
    minWidth: 0,
    height: "auto",
    justifyContent: "space-between",
    // Narrow screens keep the first lesson inside the first screen.
    // On phones, 2px less than spacing-2 each side pays for the card's 1px borders and the header's rule.
    paddingBlock: { default: "var(--spacing-4)", "@media (max-width: 480px)": "calc(var(--spacing-2) - 2px)" },
    paddingInline: { default: "var(--spacing-4)", "@media (max-width: 480px)": "var(--spacing-3)" },
    textAlign: "start",
    whiteSpace: "normal",
    backgroundColor: "var(--color-background-surface)",
    color: "var(--color-text-primary)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--color-border)",
    borderRadius: "var(--radius-container)",
    boxShadow: "var(--shadow-low)",
    flexWrap: "wrap",
  },
  // A card: the cover on top and the lesson's button below it share one frame, as on the design's
  // library cards.
  card: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    minWidth: 0,
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--color-border)",
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-surface)",
    boxShadow: "var(--shadow-low)",
  },
  // Values no other button uses: StyleX shares one class per declaration, and these override
  // classes rank above component styles, so a common value like "none" would also win elsewhere.
  framedButton: {
    borderColor: "transparent",
    borderRadius: "0 0 var(--radius-container) var(--radius-container)",
    boxShadow: "0 0 0 0 transparent",
  },
  // Phones skip the cover, keeping the first lesson inside the first screen.
  thumbnail: {
    position: "relative",
    display: { default: "block", "@media (max-width: 480px)": "none" },
    width: "100%",
    aspectRatio: "2 / 1",
    overflow: "hidden",
    backgroundColor: "#0A0C0F",
    cursor: "pointer",
  },
  thumbnailImage: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  // A play mark and a "Video" tag on the thumbnail, as on the canvas's library cards.
  play: {
    position: "absolute",
    insetInlineStart: "50%",
    top: "50%",
    width: "44px",
    height: "44px",
    marginInlineStart: "-22px",
    marginTop: "-22px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--radius-full)",
    backgroundColor: "rgba(10, 12, 15, 0.72)",
    color: "#FFFFFF",
  },
  videoTag: {
    position: "absolute",
    insetInlineEnd: "var(--spacing-2)",
    bottom: "var(--spacing-2)",
    padding: "var(--spacing-0-5) var(--spacing-1-5)",
    borderRadius: "var(--radius-inner)",
    backgroundColor: "rgba(10, 12, 15, 0.72)",
    color: "#FFFFFF",
    fontSize: "0.75rem",
    fontWeight: "var(--font-weight-bold)",
    letterSpacing: "0.04em",
  },
  // A text lesson's cover: a waveform drawn from its title on its level's tint, listening bars
  // then softer speaking bars, so every card differs and the grid reads by level.
  textCover: {
    aspectRatio: "4 / 1",
  },
  bars: {
    position: "absolute",
    inset: "20% var(--spacing-4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "1.5%",
  },
  bar: {
    flex: "1 1 0",
    maxWidth: "5px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "currentColor",
  },
  speakBar: { opacity: 0.45 },
  // The WPM target as quiet metadata, so the title leads the card.
  wpmBadge: {
    backgroundColor: "var(--color-background-muted)",
    color: "var(--color-text-secondary)",
    fontFamily: "var(--rte-font-mono)",
  },
  titleAndMeta: {
    minWidth: 0,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
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

// Each level's tint behind a text lesson's cover; its bars and tile take the level color.
export const levelTints = stylex.create({
  A1: { backgroundColor: "var(--rte-color-level-a1-muted)", color: "var(--rte-color-level-a1)" },
  A2: { backgroundColor: "var(--rte-color-level-a2-muted)", color: "var(--rte-color-level-a2)" },
  B1: { backgroundColor: "var(--rte-color-level-b1-muted)", color: "var(--rte-color-level-b1)" },
  B2: { backgroundColor: "var(--rte-color-level-b2-muted)", color: "var(--rte-color-level-b2)" },
});

const levelStyles = stylex.create({
  A1: {
    color: "var(--rte-color-level-a1)",
  },
  A2: {
    color: "var(--rte-color-level-a2)",
  },
  B1: {
    color: "var(--rte-color-level-b1)",
  },
  B2: {
    color: "var(--rte-color-level-b2)",
  },
});

// Decorative: the card's title names the lesson. A thumbnail that fails to load leaves the dark frame.
// Clicking it opens the lesson too; keyboard and screen reader users reach the lesson's button below it.
function VideoThumbnail({ videoId, onSelect }: { videoId: string; onSelect: () => void }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  return (
    <span aria-hidden="true" className={stylex.props(styles.thumbnail).className} onClick={onSelect}>
      {!failed && (
        <img
          src={`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className={stylex.props(styles.thumbnailImage).className}
          onError={() => setFailed(true)}
        />
      )}
      <span className={stylex.props(styles.play).className}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path d="M7 4.5v11l9-5.5z" />
        </svg>
      </span>
      <span className={stylex.props(styles.videoTag).className}>{t("VIDEO")}</span>
    </span>
  );
}

const BARS = 40;

// Bar heights from 20% to 100%, fixed per title so each lesson keeps its own cover.
export function coverBars(title: string): number[] {
  let seed = 2166136261;
  for (const char of title) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  return Array.from({ length: BARS }, (_, index) => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0;
    seed = (seed + index * 2654435761) >>> 0;
    // A gentle arch, as speech rises and falls, with the seed's variation on top.
    const arch = Math.sin(((index + 0.5) / BARS) * Math.PI);
    return Math.round(20 + 80 * (0.35 * arch + 0.65 * ((seed % 1000) / 1000)));
  });
}

// Decorative, like the video thumbnail: the card's title names the lesson, and clicking the cover opens it too.
function TextCover({ title, level, onSelect }: { title: string; level: Level; onSelect: () => void }) {
  return (
    <span aria-hidden="true" className={stylex.props(styles.thumbnail, styles.textCover, levelTints[level]).className} onClick={onSelect}>
      <span className={stylex.props(styles.bars).className}>
        {coverBars(title).map((height, index) => (
          <span
            key={index}
            className={stylex.props(styles.bar, index >= BARS / 2 && styles.speakBar).className}
            style={{ height: `${height}%` }}
          />
        ))}
      </span>
    </span>
  );
}

export function LessonCard({
  title,
  level,
  sentenceCount,
  targetWpm,
  completed,
  onSelect,
  takeFocus,
  videoId,
}: {
  // A video lesson's YouTube id: the card shows the video's thumbnail, which loads from YouTube.
  videoId?: string;
  title: string;
  level: Level;
  sentenceCount: number;
  targetWpm: number;
  completed: boolean;
  onSelect: () => void;
  takeFocus: () => boolean;
}) {
  const t = useT();
  const metaId = useId();
  const wpmId = useId();
  const completedId = useId();
  const button = (
    <Button
      ref={(button) => {
        if (button && takeFocus()) button.focus();
      }}
      label={title}
      aria-describedby={completed ? `${metaId} ${wpmId} ${completedId}` : `${metaId} ${wpmId}`}
      variant="secondary"
      width="100%"
      xstyle={[styles.button, levelStyles[level], styles.framedButton]}
      endContent={(
        <HStack gap={1} align="center" xstyle={styles.badges}>
          <Badge label={t("{wpm} WPM", { wpm: targetWpm })} variant="info" id={wpmId} xstyle={styles.wpmBadge} />
          {completed && (
            <HStack gap={0.5} align="center" xstyle={styles.completed}>
              <span aria-hidden="true" className={stylex.props(styles.check).className}>✓</span>
              <Text type="supporting" weight="semibold" id={completedId}>{t("Completed")}</Text>
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
            <Text type="supporting">{t("· {count} sentences", { count: sentenceCount })}</Text>
          </HStack>
        </span>
      </VStack>
    </Button>
  );
  return (
    <div className={stylex.props(styles.card).className}>
      {videoId === undefined ? (
        <TextCover title={title} level={level} onSelect={onSelect} />
      ) : (
        <VideoThumbnail videoId={videoId} onSelect={onSelect} />
      )}
      {button}
    </div>
  );
}
