import { Fragment, useEffect, useRef, useState } from "react";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { Status } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import type { StopMedia } from "../hooks/usePracticeMedia";
import { recognizeOnce } from "../lib/recognition";
import { PASS_SCORE, scoreShadow, wordLevel, type ShadowScore, type WordLevel } from "../lib/shadowScore";
import { speak, speechSupported } from "../lib/speech";

export const SLOW_SPEED = 0.75;

const RING_RADIUS = 25;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

const styles = stylex.create({
  gate: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-3)",
    padding: "var(--spacing-4)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-surface)",
  },
  row: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "var(--spacing-3)",
  },
  phase: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-0-5)",
    minWidth: 0,
    flex: "1 1 12rem",
  },
  phaseLabel: {
    fontSize: "var(--text-supporting-size)",
    lineHeight: "var(--text-supporting-leading)",
    fontWeight: "var(--font-weight-bold)",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  speakLabel: { color: "var(--rte-color-speak)" },
  goodLabel: { color: "var(--color-success)" },
  fairLabel: { color: "var(--color-warning)" },
  missLabel: { color: "var(--color-error)" },
  // The round speak button: the one orange control, where the learner's own voice goes.
  sayIt: {
    width: "56px",
    height: "56px",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    border: 0,
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--rte-color-speak)",
    color: "var(--color-on-accent)",
    boxShadow: "0 0 0 6px var(--rte-color-speak-muted)",
    cursor: "pointer",
    ":disabled": { cursor: "not-allowed", opacity: 0.6 },
    ":focus-visible": { outline: "2px solid var(--focus-outline-color)", outlineOffset: 8 },
  },
  ring: {
    position: "relative",
    width: "56px",
    height: "56px",
    flexShrink: 0,
  },
  ringNumber: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.125rem",
    fontWeight: "var(--font-weight-bold)",
    fontVariantNumeric: "tabular-nums",
  },
  words: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: "var(--spacing-1) var(--spacing-2)",
    margin: 0,
    fontSize: "var(--rte-text-reading-size)",
    lineHeight: 2,
    fontWeight: "var(--font-weight-medium)",
  },
  word: {
    textUnderlineOffset: "6px",
  },
  heard: {
    fontSize: "var(--text-supporting-size)",
    fontWeight: "normal",
    color: "var(--color-text-secondary)",
  },
});

// Each level has its own underline, so the levels never rest on color alone.
const levelStyles = stylex.create({
  good: { color: "var(--color-success)", textDecoration: "underline double" },
  fair: { color: "var(--color-warning)", textDecorationLine: "underline", textDecorationStyle: "dotted", textDecorationThickness: "2px" },
  miss: { color: "var(--color-error)", textDecorationLine: "underline", textDecorationStyle: "solid", textDecorationThickness: "3px" },
});

const ringColors: Record<WordLevel, string> = {
  good: "var(--color-success)",
  fair: "var(--color-warning)",
  miss: "var(--color-error)",
};

const LEVEL_NAMES: Record<WordLevel, string> = { good: "clear", fair: "close", miss: "missed" };

export function ScoreRing({ score }: { score: number }) {
  const color = ringColors[wordLevel(score)];
  return (
    <div role="img" aria-label={`Score ${score} of 100`} className={stylex.props(styles.ring).className}>
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r={RING_RADIUS} fill="none" stroke="var(--color-background-muted)" strokeWidth="5" />
        <circle
          cx="28"
          cy="28"
          r={RING_RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * RING_LENGTH} ${RING_LENGTH}`}
          transform="rotate(-90 28 28)"
        />
      </svg>
      <span aria-hidden="true" className={stylex.props(styles.ringNumber).className} style={{ color }}>
        {score}
      </span>
    </div>
  );
}

// Every reference word in its level's color and underline; a near or missed word shows what was heard.
export function ScoredWords({ result }: { result: ShadowScore }) {
  return (
    <p className={stylex.props(styles.words).className}>
      {result.words.map((word, index) => (
        <Fragment key={index}>
          <span className={stylex.props(styles.word, levelStyles[word.level]).className}>
            {word.word}
            <VisuallyHidden> ({LEVEL_NAMES[word.level]}{word.heard ? `, heard "${word.heard}"` : ""})</VisuallyHidden>
          </span>
          {word.heard && word.level !== "good" && (
            <span aria-hidden="true" className={stylex.props(styles.heard).className}>
              ({word.heard})
            </span>
          )}
        </Fragment>
      ))}
    </p>
  );
}

function MicIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="2.5" width="6" height="10" rx="3" />
      <path d="M4 10a6 6 0 0 0 12 0M10 16v2" />
    </svg>
  );
}

type Check =
  | { status: "idle" }
  | { status: "listening" }
  | { status: "heard"; transcript: string; result: ShadowScore }
  | { status: "failed"; message: string };

// Shadow Gate for one sentence: say it, see each word scored, and pass at PASS_SCORE to unlock the next.
export function ShadowGate({
  text,
  targetWpm,
  passed,
  stopMedia,
  onChecked,
}: {
  text: string;
  targetWpm: number;
  // Passed (or skipped) earlier this visit.
  passed: boolean;
  stopMedia: StopMedia;
  onChecked: (result: ShadowScore) => void;
}) {
  const [check, setCheck] = useState<Check>({ status: "idle" });
  const recognitionRef = useRef<ReturnType<typeof recognizeOnce> | null>(null);
  const sayItRef = useRef<HTMLButtonElement>(null);
  const canSpeak = speechSupported();

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [],
  );

  const sayIt = () => {
    stopMedia();
    setCheck({ status: "listening" });
    const recognition = recognizeOnce();
    recognitionRef.current = recognition;
    recognition.result.then(
      (transcript) => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        const result = scoreShadow(transcript, text);
        setCheck({ status: "heard", transcript, result });
        if (transcript.trim()) {
          onChecked(result);
        }
      },
      (error: Error) => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setCheck(error.name === "AbortError" ? { status: "idle" } : { status: "failed", message: error.message });
      },
    );
  };

  // Try again removes the result and itself, so focus goes back to the speak button.
  const tryAgain = () => {
    setCheck({ status: "idle" });
    requestAnimationFrame(() => sayItRef.current?.focus());
  };

  const listening = check.status === "listening";
  const result = check.status === "heard" ? check.result : null;
  let label: { text: string; style: keyof typeof levelLabel };
  let hint: string;
  if (listening) {
    label = { text: "Listening…", style: "speak" };
    hint = "Say the sentence now.";
  } else if (result && result.passed) {
    label = { text: `Unlocked · ${result.score} points`, style: "good" };
    hint = "The next sentence is open.";
  } else if (result) {
    label = { text: `Not yet · ${result.score} points`, style: result.score >= 50 ? "fair" : "miss" };
    hint = `Reach ${PASS_SCORE} to open the next sentence. Listen slowly, then try again.`;
  } else if (passed) {
    label = { text: "Unlocked", style: "good" };
    hint = "Say it again any time to practise.";
  } else {
    label = { text: "Your turn", style: "speak" };
    hint = `Say the sentence. Reach ${PASS_SCORE} points to open the next one.`;
  }

  return (
    <section aria-label="Shadow Gate" className={stylex.props(styles.gate).className}>
      <div className={stylex.props(styles.row).className}>
        {result ? (
          <ScoreRing score={result.score} />
        ) : (
          <button
            ref={sayItRef}
            type="button"
            aria-label={listening ? "Listening" : "Say the sentence"}
            data-shortcut="speak"
            disabled={listening}
            className={stylex.props(styles.sayIt).className}
            onClick={sayIt}
          >
            <MicIcon />
          </button>
        )}
        <div className={stylex.props(styles.phase).className}>
          <span className={stylex.props(styles.phaseLabel, levelLabel[label.style]).className}>{label.text}</span>
          <Text type="supporting">{hint}</Text>
        </div>
        <HStack gap={1} wrap="wrap">
          {result && <Button label="Try again" variant="secondary" data-shortcut="retry" onClick={tryAgain} />}
          <Button
            label={`Listen slowly ${SLOW_SPEED}×`}
            variant="ghost"
            data-shortcut="slow"
            isDisabled={!canSpeak || listening}
            onClick={() => {
              stopMedia();
              speak(text, targetWpm, SLOW_SPEED);
            }}
          />
        </HStack>
      </div>
      <Status>
        {result && (
          <VStack gap={1}>
            <ScoredWords result={result} />
            <VisuallyHidden>
              {result.passed ? `Score ${result.score}. Next sentence unlocked.` : `Score ${result.score}. Reach ${PASS_SCORE} to unlock the next sentence.`}
            </VisuallyHidden>
          </VStack>
        )}
        {check.status === "failed" && (
          <Text as="p" color="primary" xstyle={sharedStyles.error}>
            {check.message}
          </Text>
        )}
      </Status>
      {check.status === "failed" && <Button label="Try again" variant="ghost" onClick={tryAgain} />}
    </section>
  );
}

const levelLabel = {
  speak: styles.speakLabel,
  good: styles.goodLabel,
  fair: styles.fairLabel,
  miss: styles.missLabel,
};
