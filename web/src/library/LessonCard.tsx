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
    paddingBlock: { default: "var(--spacing-4)", "@media (max-width: 480px)": "var(--spacing-2)" },
    paddingInline: { default: "var(--spacing-4)", "@media (max-width: 480px)": "var(--spacing-3)" },
    textAlign: "start",
    whiteSpace: "normal",
    backgroundColor: "var(--color-background-surface)",
    color: "var(--color-text-primary)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-container)",
    boxShadow: "var(--shadow-low)",
    flexWrap: "wrap",
  },
  // A video card: the thumbnail on top and the lesson's button below it share one frame, as on the
  // canvas's library cards.
  videoCard: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    minWidth: 0,
    overflow: "hidden",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-surface)",
    boxShadow: "var(--shadow-low)",
  },
  // Values no other button uses: StyleX shares one class per declaration, and these override
  // classes rank above component styles, so a common value like "none" would also win elsewhere.
  videoButton: {
    borderColor: "transparent",
    borderRadius: "0 0 var(--radius-container) var(--radius-container)",
    boxShadow: "0 0 0 0 transparent",
  },
  thumbnail: {
    position: "relative",
    display: "block",
    width: "100%",
    aspectRatio: "16 / 9",
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
      xstyle={[styles.button, levelStyles[level], videoId !== undefined && styles.videoButton]}
      endContent={(
        <HStack gap={1} align="center" xstyle={styles.badges}>
          <Badge label={t("{wpm} WPM", { wpm: targetWpm })} variant="info" id={wpmId} />
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
  if (videoId === undefined) return button;
  return (
    <div className={stylex.props(styles.videoCard).className}>
      <VideoThumbnail videoId={videoId} onSelect={onSelect} />
      {button}
    </div>
  );
}
