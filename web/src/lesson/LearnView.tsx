import { useId, useState, type CSSProperties, type ReactNode } from "react";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import * as stylex from "@stylexjs/stylex";

import type { Sentence } from "../api/lessons";
import { Status } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import { useT } from "../i18n";
import { diffWords } from "../lib/dictation";
import { lookupWord } from "../lib/dictionary";
import { PASS_SCORE, wordLevel, type ShadowScore, type WordLevel } from "../lib/shadowScore";
import { splitWords } from "../lib/words";

const MONO = 'var(--rte-font-mono)';

const styles = stylex.create({
  // The stage: a dark frame like a video, with the sentence as its caption.
  stage: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    gap: "var(--spacing-4)",
    minHeight: { default: "15rem", "@media (max-width: 480px)": "11rem" },
    padding: "var(--spacing-4)",
    borderRadius: "var(--radius-container)",
    backgroundColor: "#0A0C0F",
    boxShadow: "var(--shadow-low)",
    color: "#FFFFFF",
  },
  stageTop: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--spacing-2)",
  },
  tags: {
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--spacing-2)",
  },
  tag: {
    padding: "var(--spacing-0-5) var(--spacing-2)",
    borderRadius: "var(--radius-inner)",
    backgroundColor: "rgba(10, 12, 15, 0.72)",
    border: "1px solid rgba(255, 255, 255, 0.16)",
    color: "#C9CED6",
    fontSize: "0.75rem",
    fontWeight: "var(--font-weight-bold)",
    letterSpacing: "0.04em",
  },
  mono: { fontFamily: MONO, fontVariantNumeric: "tabular-nums" },
  chips: {
    display: "flex",
    gap: "var(--spacing-1)",
    margin: 0,
    padding: 0,
    border: 0,
  },
  chip: {
    minWidth: "44px",
    minHeight: "32px",
    padding: "0 var(--spacing-2-5, 10px)",
    borderRadius: "var(--radius-full)",
    border: "1px solid #6B737D",
    backgroundColor: "transparent",
    color: "#C9CED6",
    fontFamily: MONO,
    fontSize: "0.75rem",
    cursor: "pointer",
    ":focus-visible": { outline: "2px solid #4FC3CC", outlineOffset: 2 },
  },
  chipOn: {
    borderColor: "#4FC3CC",
    backgroundColor: "#4FC3CC",
    color: "#0A0C0F",
  },
  caption: {
    alignSelf: "center",
    maxWidth: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--spacing-1)",
    padding: "var(--spacing-2) var(--spacing-4)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "rgba(10, 12, 15, 0.72)",
    textAlign: "center",
    overflowWrap: "anywhere",
  },
  captionVi: {
    margin: 0,
    color: "#C9CED6",
    fontSize: "1rem",
    lineHeight: 1.5,
  },
  // A strip of one bar per word: teal while the sentence waits, each word's level once it is scored.
  strip: {
    flex: "1 1 8rem",
    minWidth: "6rem",
    display: "flex",
    alignItems: "center",
    gap: "3px",
    height: "40px",
    overflow: "hidden",
  },
  bar: {
    flex: "0 1 6px",
    minWidth: "3px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--color-accent)",
    opacity: 0.85,
  },
  // The transcript panel beside the stage on wide screens.
  transcript: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-1)",
    padding: "var(--spacing-3)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-surface)",
    boxShadow: "var(--shadow-low)",
    alignSelf: "start",
    position: { default: "sticky", "@media (max-width: 1023px)": "static" },
    top: "var(--spacing-4)",
    maxHeight: { default: "calc(100vh - var(--spacing-8))", "@media (max-width: 1023px)": "none" },
    overflowY: "auto",
  },
  transcriptHead: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--spacing-2)",
    padding: "var(--spacing-1) var(--spacing-1) var(--spacing-2)",
  },
  eyebrow: {
    margin: 0,
    color: "var(--color-text-secondary)",
    fontSize: "var(--text-supporting-size)",
    fontWeight: "var(--font-weight-bold)",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  lines: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-1)",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  line: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "start",
    gap: "var(--spacing-3)",
    width: "100%",
    padding: "var(--spacing-3)",
    border: 0,
    borderRadius: "var(--radius-element)",
    backgroundColor: "transparent",
    color: "var(--color-text-primary)",
    font: "inherit",
    textAlign: "start",
  },
  lineButton: {
    cursor: "pointer",
    ":hover": { backgroundColor: "var(--color-background-muted)" },
    ":focus-visible": { outline: "2px solid var(--focus-outline-color)", outlineOffset: 2 },
  },
  current: {
    backgroundColor: "var(--color-accent-muted)",
    outline: "1px solid var(--color-accent)",
  },
  locked: {
    color: "var(--color-text-secondary)",
  },
  stamp: {
    fontFamily: MONO,
    fontSize: "0.75rem",
    lineHeight: "1.5rem",
    color: "var(--color-text-secondary)",
    fontVariantNumeric: "tabular-nums",
  },
  stampCurrent: { color: "var(--color-accent)" },
  lineText: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  lineVi: {
    color: "var(--color-text-secondary)",
    fontSize: "var(--text-supporting-size)",
    lineHeight: "var(--text-supporting-leading)",
  },
  score: {
    fontFamily: MONO,
    fontWeight: "var(--font-weight-bold)",
    lineHeight: "1.5rem",
    fontVariantNumeric: "tabular-nums",
  },
  // Enlarged text wraps a label instead of pushing its button off a narrow screen.
  wrapButton: {
    maxWidth: "100%",
    height: "auto",
    minHeight: "var(--size-element-md)",
    whiteSpace: "normal",
    textAlign: "start",
  },
  wrapLabel: {
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  },
  // The feedback card under a sentence that did not pass yet.
  feedback: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "var(--spacing-3) var(--spacing-4)",
    padding: "var(--spacing-4) var(--spacing-5)",
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--rte-color-speak-muted)",
    color: "var(--color-text-primary)",
  },
  feedbackText: {
    flex: "1 1 16rem",
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-1)",
    minWidth: 0,
  },
  ipa: {
    fontFamily: MONO,
    color: "var(--color-error)",
  },
  typeForm: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-2)",
  },
  summary: {
    cursor: "pointer",
    width: "fit-content",
    minHeight: "var(--size-element-md)",
    display: "flex",
    alignItems: "center",
    color: "var(--color-text-accent)",
    fontWeight: "var(--font-weight-medium)",
    ":focus-visible": { outline: "2px solid var(--focus-outline-color)", outlineOffset: 2, borderRadius: "var(--radius-inner)" },
  },
});

const levelBar = stylex.create({
  good: { backgroundColor: "var(--color-success)" },
  fair: { backgroundColor: "var(--color-warning)" },
  miss: { backgroundColor: "var(--color-error)" },
});

const levelColor: Record<WordLevel, string> = {
  good: "var(--color-success)",
  fair: "var(--color-warning)",
  miss: "var(--color-error)",
};

// The stage's own colors, so the clickable words of the caption read white on the dark frame.
const stageTokens = {
  "--color-text-primary": "#FFFFFF",
  "--color-text-secondary": "#C9CED6",
  "--color-icon-primary": "#FFFFFF",
  "--color-background-muted": "rgba(255, 255, 255, 0.14)",
  "--color-overlay-pressed": "rgba(255, 255, 255, 0.2)",
  "--color-accent": "#4FC3CC",
  "--color-accent-muted": "#123A3E",
  "--color-on-accent": "#0A0C0F",
  "--color-text-accent": "#4FC3CC",
  "--color-border": "rgba(255, 255, 255, 0.24)",
  "--color-background-surface": "#22272E",
  "--focus-outline-color": "#4FC3CC",
} as CSSProperties;

// "1:24" for a video cue; "01" for a plain lesson's line number.
function stamp(sentence: Sentence, index: number): string {
  if (sentence.cue) {
    const seconds = Math.floor(sentence.cue.start);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return String(index + 1).padStart(2, "0");
}

export function LearnStage({
  position,
  speeds,
  speed,
  setSpeed,
  vi,
  children,
}: {
  position: string;
  speeds: readonly string[];
  speed: string;
  setSpeed: (speed: string) => void;
  // The sentence's Vietnamese, while it is shown.
  vi: string | null;
  // The sentence's words, which the learner can tap.
  children: ReactNode;
}) {
  const t = useT();
  const speedLabel = useId();
  return (
    <section aria-label={t("Sentence stage")} className={stylex.props(styles.stage).className} style={stageTokens}>
      <div className={stylex.props(styles.stageTop).className}>
        <div className={stylex.props(styles.tags).className}>
          <span className={stylex.props(styles.tag, styles.mono).className}>{position}</span>
          <span className={stylex.props(styles.tag).className}>{t("LEARN MODE")}</span>
        </div>
        <div role="group" aria-labelledby={speedLabel} className={stylex.props(styles.chips).className}>
          <VisuallyHidden id={speedLabel}>{t("Playback speed")}</VisuallyHidden>
          {speeds.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === speed}
              className={stylex.props(styles.chip, value === speed && styles.chipOn).className}
              onClick={() => setSpeed(value)}
            >
              {value}×
            </button>
          ))}
        </div>
      </div>
      <div className={stylex.props(styles.caption).className}>
        {children}
        {vi && (
          <p lang="vi" className={stylex.props(styles.captionVi).className}>
            {vi}
          </p>
        )}
      </div>
    </section>
  );
}

// One bar per word of the sentence, its height from the word's length: teal before a score, then each
// word's level. Decorative: the scored words below say the same in text.
export function ScoreStrip({ text, result }: { text: string; result: ShadowScore | null }) {
  const words = result ? result.words.map((word) => word.word) : splitWords(text).filter((part) => /[\p{L}\p{N}]/u.test(part));
  return (
    <div aria-hidden="true" data-testid="score-strip" className={stylex.props(styles.strip).className}>
      {words.map((word, index) => {
        const level = result?.words[index]?.level;
        return (
          <span
            key={index}
            className={stylex.props(styles.bar, level && levelBar[level]).className}
            style={{ height: Math.min(36, 8 + word.length * 3) }}
          />
        );
      })}
    </div>
  );
}

// The words that did not pass, worst first, with what was heard and, on request, their pronunciation.
export function FeedbackCard({ result, children }: { result: ShadowScore; children: ReactNode }) {
  const t = useT();
  const unclear = result.words.filter((word) => word.level !== "good").sort((a, b) => a.score - b.score);
  const worst = unclear[0];
  const [ipa, setIpa] = useState<{ word: string; text: string } | null>(null);
  const [looking, setLooking] = useState(false);
  if (!worst) return null;
  return (
    <div className={stylex.props(styles.feedback).className} data-testid="feedback-card">
      <div className={stylex.props(styles.feedbackText).className}>
        <Text as="p">
          {worst.heard
            ? t('"{word}" was not clear: the browser heard "{heard}".', { word: worst.word, heard: worst.heard })
            : t('"{word}" was missed.', { word: worst.word })}
          {unclear.length === 2 && ` ${t("1 more word to work on.")}`}
          {unclear.length > 2 && ` ${t("{count} more words to work on.", { count: unclear.length - 1 })}`}
        </Text>
        <Status>
          {ipa?.word === worst.word && <span className={stylex.props(styles.ipa).className}>{ipa.text}</span>}
        </Status>
      </div>
      <HStack gap={1} wrap="wrap">
        {ipa?.word !== worst.word && (
          <Button
            label={t("Show how to say it")}
            variant="secondary"
            xstyle={styles.wrapButton}
            children={<span className={stylex.props(styles.wrapLabel).className}>{t("Show how to say it")}</span>}
            isLoading={looking}
            onClick={() => {
              setLooking(true);
              lookupWord(worst.word.toLowerCase()).then(
                (found) => setIpa({ word: worst.word, text: found?.phonetic ?? t("No pronunciation found for this word.") }),
                () => setIpa({ word: worst.word, text: t("Couldn't reach the dictionary. Try again later.") }),
              ).finally(() => setLooking(false));
            }}
          />
        )}
        {children}
      </HStack>
    </div>
  );
}

// "Can't speak right now?": typing the whole sentence correctly also unlocks it.
export function TypeInstead({ text, onPassed }: { text: string; onPassed: () => void }) {
  const t = useT();
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<"right" | "wrong" | null>(null);
  return (
    <details>
      <summary className={stylex.props(styles.summary).className}>{t("Can't speak right now? Type it instead")}</summary>
      <form
        className={stylex.props(styles.typeForm).className}
        onSubmit={(event) => {
          event.preventDefault();
          const right = diffWords(typed, text).every((entry) => entry.kind === "correct");
          setResult(right ? "right" : "wrong");
          if (right) onPassed();
        }}
      >
        <label htmlFor={inputId}>
          <Text type="supporting">{t("Type the sentence you heard. Getting every word right unlocks the next one.")}</Text>
        </label>
        <input
          id={inputId}
          className={stylex.props(sharedStyles.dictationInput).className}
          value={typed}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setTyped(event.target.value);
            setResult(null);
          }}
        />
        <HStack gap={1} align="center" wrap="wrap">
          <Button label={t("Check typing")} type="submit" variant="secondary" />
          <Status>
            {result === "right" && <Text type="supporting">{t("Every word is right. The next sentence is open.")}</Text>}
            {result === "wrong" && <Text type="supporting">{t("Not every word matches yet. Listen again and fix it.")}</Text>}
          </Status>
        </HStack>
      </form>
    </details>
  );
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="9" width="12" height="8.5" rx="2" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </svg>
  );
}

// Every sentence of the lesson: the open ones can be chosen, the ones after the first locked sentence wait.
export function LearnTranscript({
  sentences,
  current,
  passed,
  scores,
  showVietnamese,
  onOpen,
}: {
  sentences: Sentence[];
  current: number;
  passed: ReadonlySet<string>;
  // This visit's best score per sentence.
  scores: ReadonlyMap<string, number>;
  showVietnamese: boolean;
  onOpen: (index: number) => void;
}) {
  const t = useT();
  // A sentence opens once every sentence before it has passed.
  const firstLocked = sentences.findIndex((_, index) => index > 0 && !passed.has(sentences[index - 1].id));
  const openUpTo = firstLocked === -1 ? sentences.length - 1 : firstLocked - 1;
  return (
    <aside aria-label={t("Transcript")} className={stylex.props(styles.transcript).className}>
      <div className={stylex.props(styles.transcriptHead).className}>
        <p className={stylex.props(styles.eyebrow).className}>{t("Transcript")}</p>
        <Text type="supporting">
          {t("Sentence")}{" "}
          <span className={stylex.props(styles.mono).className}>
            {current + 1}/{sentences.length}
          </span>
        </Text>
      </div>
      <ol className={stylex.props(styles.lines).className}>
        {sentences.map((sentence, index) => {
          const open = index <= openUpTo || index <= current;
          const isCurrent = index === current;
          const score = scores.get(sentence.id);
          const mark =
            score !== undefined ? (
              <span className={stylex.props(styles.score).className} style={{ color: levelColor[wordLevel(score)] }}>
                {score}
              </span>
            ) : passed.has(sentence.id) ? (
              <span className={stylex.props(styles.score).className} style={{ color: "var(--color-success)" }} aria-label={t("unlocked")}>
                ✓
              </span>
            ) : !open ? (
              <span role="img" aria-label={t("Locked")}>
                <LockIcon />
              </span>
            ) : null;
          const content = (
            <>
              <span className={stylex.props(styles.stamp, isCurrent && styles.stampCurrent).className}>{stamp(sentence, index)}</span>
              <span className={stylex.props(styles.lineText).className}>
                {open ? (
                  <>
                    <span>{sentence.text}</span>
                    {showVietnamese && sentence.vi && (
                      <span lang="vi" className={stylex.props(styles.lineVi).className}>
                        {sentence.vi}
                      </span>
                    )}
                  </>
                ) : index === openUpTo + 1 ? (
                  <span className={stylex.props(styles.lineVi).className}>
                    {t("Reach {score} points on the sentence above to unlock this one", { score: PASS_SCORE })}
                  </span>
                ) : (
                  <span className={stylex.props(styles.lineVi).className}>{t("Locked")}</span>
                )}
              </span>
              {mark ?? <span />}
            </>
          );
          return (
            <li key={sentence.id}>
              {open && !isCurrent ? (
                <button type="button" className={stylex.props(styles.line, styles.lineButton).className} onClick={() => onOpen(index)}>
                  {content}
                </button>
              ) : (
                <div
                  aria-current={isCurrent ? "step" : undefined}
                  className={stylex.props(styles.line, isCurrent && styles.current, !open && styles.locked).className}
                >
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
