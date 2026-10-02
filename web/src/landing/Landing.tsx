import { useEffect, type ReactNode } from "react";

import { Button } from "@astryxdesign/core/Button";
import * as stylex from "@stylexjs/stylex";

import { APP_TITLE } from "../components/feedback";
import { useLessons } from "../hooks/lessons";
import { ScoreRing, ScoredWords } from "../lesson/ShadowGate";
import { LessonCard } from "../library/LessonCard";
import { FAIR_SCORE, GOOD_SCORE, PASS_SCORE, scoreShadow } from "../lib/shadowScore";
import { SKIPS_PER_LESSON } from "../lesson/GuidedShadowing";

const EXAMPLE_SENTENCE = "I've never seen anything like it.";
const EXAMPLE_VI = "Tôi chưa từng thấy thứ gì như vậy.";
// What a learner might say: one near miss and one wrong word, scored by the app's own scoring.
const EXAMPLE = scoreShadow("I've never scene everyone like it", EXAMPLE_SENTENCE);

const styles = stylex.create({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: { default: "var(--spacing-12)", "@media (max-width: 480px)": "var(--spacing-8)" },
    paddingBlock: "var(--spacing-4)",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 24rem), 1fr))",
    gap: "var(--spacing-8)",
    alignItems: "center",
  },
  heroText: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-5)",
    minWidth: 0,
  },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--spacing-2)",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  chip: {
    padding: "var(--spacing-1) var(--spacing-3)",
    borderRadius: "var(--radius-full)",
    fontSize: "var(--text-supporting-size)",
    fontWeight: "var(--font-weight-bold)",
    letterSpacing: "0.04em",
  },
  listenChip: { backgroundColor: "var(--color-accent-muted)", color: "var(--color-accent)" },
  speakChip: { backgroundColor: "var(--rte-color-speak-muted)", color: "var(--rte-color-speak)" },
  unlockChip: { backgroundColor: "var(--color-background-muted)", color: "var(--color-text-secondary)" },
  display: {
    margin: 0,
    fontSize: { default: "3.25rem", "@media (max-width: 480px)": "2.25rem" },
    lineHeight: 1.1,
    fontWeight: "var(--font-weight-bold)",
    letterSpacing: "-0.02em",
    overflowWrap: "anywhere",
    ":focus-visible": { outline: "2px solid var(--focus-outline-color)", outlineOffset: 4 },
  },
  speakText: { color: "var(--rte-color-speak)" },
  lead: {
    margin: 0,
    maxWidth: "32rem",
    fontSize: "1.125rem",
    lineHeight: 1.6,
    color: "var(--color-text-secondary)",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--spacing-3)",
  },
  // Wraps a primary button in the speak color: the button reads its fill and label from these tokens.
  speakButton: {
    display: "contents",
    "--color-accent": "var(--rte-color-speak)",
  },
  example: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-3)",
    minWidth: 0,
  },
  frame: {
    overflow: "hidden",
    borderRadius: "var(--radius-container)",
    backgroundColor: "#0A0C0F",
    boxShadow: "var(--shadow-low)",
  },
  frameTop: {
    aspectRatio: "16 / 7",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "var(--spacing-2)",
    padding: "var(--spacing-4)",
  },
  frameTag: {
    padding: "var(--spacing-0-5) var(--spacing-2)",
    borderRadius: "var(--radius-inner)",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    color: "#C9CED6",
    fontSize: "0.75rem",
    fontWeight: "var(--font-weight-bold)",
    letterSpacing: "0.04em",
  },
  caption: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--spacing-0-5)",
    padding: "var(--spacing-3) var(--spacing-4) var(--spacing-4)",
    textAlign: "center",
  },
  captionEn: { margin: 0, color: "#FFFFFF", fontSize: "1.25rem", lineHeight: 1.45, fontWeight: "var(--font-weight-medium)" },
  captionVi: { margin: 0, color: "#C9CED6", fontSize: "0.9375rem", lineHeight: 1.5 },
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-3)",
    padding: "var(--spacing-4)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-surface)",
  },
  panelRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-3)",
  },
  muted: { margin: 0, color: "var(--color-text-secondary)" },
  eyebrow: {
    margin: 0,
    fontSize: "var(--text-supporting-size)",
    fontWeight: "var(--font-weight-bold)",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  listenEyebrow: { color: "var(--color-accent)" },
  speakEyebrow: { color: "var(--rte-color-speak)" },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-6)",
    scrollMarginTop: "var(--spacing-4)",
  },
  band: {
    padding: { default: "var(--spacing-10) var(--spacing-8)", "@media (max-width: 480px)": "var(--spacing-6) var(--spacing-4)" },
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-surface)",
    border: "1px solid var(--color-border)",
  },
  sectionHead: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-2)",
    maxWidth: "40rem",
  },
  h2: {
    margin: 0,
    fontSize: { default: "2rem", "@media (max-width: 480px)": "1.625rem" },
    lineHeight: 1.25,
    fontWeight: "var(--font-weight-bold)",
    letterSpacing: "-0.01em",
  },
  h3: {
    margin: 0,
    fontSize: "1.125rem",
    lineHeight: 1.4,
    fontWeight: "var(--font-weight-bold)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 14rem), 1fr))",
    gap: "var(--spacing-4)",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  wideGrid: {
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 17rem), 1fr))",
  },
  step: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-3)",
    padding: "var(--spacing-6)",
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-body)",
  },
  stepTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepIcon: {
    width: "44px",
    height: "44px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--radius-element)",
  },
  stepNumber: {
    color: "var(--color-text-secondary)",
    fontSize: "0.75rem",
    fontVariantNumeric: "tabular-nums",
  },
  feature: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-2)",
    padding: "var(--spacing-6)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-surface)",
  },
  listenIcon: { color: "var(--color-accent)" },
  speakIcon: { color: "var(--rte-color-speak)" },
  scoring: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 22rem), 1fr))",
    gap: "var(--spacing-8)",
    alignItems: "start",
  },
  legend: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-3)",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  legendRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: "var(--spacing-3)",
  },
  legendWord: {
    minWidth: "5.5rem",
    fontWeight: "var(--font-weight-bold)",
    textUnderlineOffset: "5px",
  },
  good: { color: "var(--color-success)", textDecoration: "underline double" },
  fair: { color: "var(--color-warning)", textDecorationLine: "underline", textDecorationStyle: "dotted", textDecorationThickness: "2px" },
  miss: { color: "var(--color-error)", textDecorationLine: "underline", textDecorationStyle: "solid", textDecorationThickness: "3px" },
  kbd: {
    display: "inline-block",
    minWidth: "1.5em",
    marginInlineEnd: "var(--spacing-1)",
    padding: "0 var(--spacing-1-5)",
    border: "1px solid var(--color-border-emphasized)",
    borderRadius: "var(--radius-inner)",
    backgroundColor: "var(--color-background-muted)",
    color: "var(--color-text-primary)",
    fontFamily: "ui-monospace, \"SF Mono\", Menlo, monospace",
    fontSize: "0.75rem",
    textAlign: "center",
  },
  keys: {
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--spacing-1) var(--spacing-3)",
    margin: 0,
    padding: 0,
    listStyle: "none",
    color: "var(--color-text-secondary)",
  },
  libraryHead: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "var(--spacing-4)",
  },
  lessonItem: {
    display: "flex",
    minWidth: 0,
  },
  cta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--spacing-8)",
    padding: { default: "var(--spacing-12)", "@media (max-width: 480px)": "var(--spacing-6)" },
    borderRadius: "var(--radius-container)",
    backgroundColor: "#0A0C0F",
  },
  ctaText: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-3)",
    maxWidth: "36rem",
  },
  ctaTitle: { color: "#FFFFFF" },
  ctaLead: { margin: 0, color: "#C9CED6", fontSize: "1rem", lineHeight: 1.6 },
  ctaActions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "var(--spacing-4)",
  },
  bars: {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    height: "40px",
  },
  bar: { width: "4px", borderRadius: "var(--radius-full)" },
  darkListen: { backgroundColor: "#4FC3CC" },
  darkSpeak: { backgroundColor: "#FF8A4C" },
  ctaButton: {
    display: "contents",
    "--color-accent": "#FF8A4C",
    "--color-on-accent": "#101317",
  },
});

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const PLAY = <path d="M6 4l10 6-10 6z" />;
const MIC = (
  <>
    <rect x="7" y="2.5" width="6" height="10" rx="3" />
    <path d="M4 10a6 6 0 0 0 12 0M10 16v2" />
  </>
);
const UNLOCK = (
  <>
    <rect x="4" y="9" width="12" height="8.5" rx="2" />
    <path d="M7 9V6.5a3 3 0 0 1 5.8-1" />
  </>
);

const STEPS = [
  {
    title: "Listen",
    text: "Hear each sentence with Listen or Loop, or play its video clip, at 0.5×, 0.75× or 1× speed.",
    icon: PLAY,
    style: "listen" as const,
  },
  {
    title: "Say it back",
    text: "Shadow along, record yourself and compare with the original, or press the round speak button.",
    icon: MIC,
    style: "speak" as const,
  },
  {
    title: "Get a score",
    text: "Your browser's speech recognition hears you, and every word is marked clear, close or missed.",
    icon: null,
    style: "score" as const,
  },
  {
    title: "Unlock",
    text: `In Learn mode the next sentence opens at ${PASS_SCORE} points. Stuck? Listen slowly, try again, or use one of ${SKIPS_PER_LESSON} skips.`,
    icon: UNLOCK,
    style: "unlock" as const,
  },
];

const stepIconStyles = stylex.create({
  listen: { backgroundColor: "var(--color-accent-muted)", color: "var(--color-accent)" },
  speak: { backgroundColor: "var(--rte-color-speak)", color: "var(--color-on-accent)", borderRadius: "var(--radius-full)" },
  score: { backgroundColor: "var(--color-background-muted)", color: "var(--color-text-primary)", fontWeight: "var(--font-weight-bold)" },
  unlock: { backgroundColor: "var(--color-success)", color: "var(--color-on-success)" },
});

const FEATURES: { title: string; text: string; tone: "listen" | "speak"; icon: ReactNode }[] = [
  {
    title: "Vietnamese alongside",
    text: "Turn on the Vietnamese translation under each sentence, and under the video's captions, when you need it.",
    tone: "listen",
    icon: <path d="M3 5h8M7 3v2M5 5c0 4 3 6 5 7M9.5 5c-.5 3-2.5 5.5-6 7M11 17l3-7 3 7M12 15h4" />,
  },
  {
    title: "Tap any word",
    text: "Look up a word's meaning and pronunciation, hear it, and save it to your review deck with its sentence.",
    tone: "listen",
    icon: <path d="M5.5 3h9v14l-4.5-3.2L5.5 17z" />,
  },
  {
    title: "Slow down and loop",
    text: "Play at 0.5×, 0.75× or 1×, and loop one sentence as long as you like before you say it.",
    tone: "listen",
    icon: (
      <>
        <path d="M3.5 14a7 7 0 1 1 13 0" />
        <path d="M10 13l3.5-4" />
      </>
    ),
  },
  {
    title: "Stress and intonation",
    text: "Show which syllable to stress and whether a sentence rises or falls, from a pronunciation dictionary.",
    tone: "listen",
    icon: <path d="M3 14l4-6 3 4 3-7 4 9" />,
  },
  {
    title: "Can't speak right now?",
    text: "Switch to dictation or fill-in-the-blank and practise the same sentences by typing.",
    tone: "speak",
    icon: (
      <>
        <rect x="2.5" y="5" width="15" height="10" rx="2" />
        <path d="M6 12h8M6 8.5h.01M9 8.5h.01M12 8.5h.01M15 8.5h.01" />
      </>
    ),
  },
  {
    title: "Spaced-repetition review",
    text: "Saved words and sentences come back for review just before you would forget them.",
    tone: "speak",
    icon: <path d="M4 8a5 5 0 0 1 8.5-3.5L15 7M15 3v4h-4M16 12a5 5 0 0 1-8.5 3.5L5 13M5 17v-4h4" />,
  },
  {
    title: "Your own lessons",
    text: "Paste a transcript or any English text, and practise it like any library lesson.",
    tone: "speak",
    icon: <path d="M5 3h7l3 3v11H5zM12 3v3h3M8 10h4M8 13h4" />,
  },
  {
    title: "Your data, your device",
    text: "Progress is stored in your browser. Sign in to sync between devices, or export a backup file.",
    tone: "speak",
    icon: (
      <>
        <rect x="4" y="9" width="12" height="8.5" rx="2" />
        <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
      </>
    ),
  },
];

const SHORTCUTS = [
  ["L", "listen"],
  ["R", "speak or record"],
  ["S", "listen slowly"],
  ["←  →", "change sentence"],
] as const;

function Bars() {
  return (
    <span aria-hidden="true" className={stylex.props(styles.bars).className}>
      {[12, 26, 18].map((height, index) => (
        <span key={`l${index}`} className={stylex.props(styles.bar, styles.darkListen).className} style={{ height }} />
      ))}
      {[34, 22, 10].map((height, index) => (
        <span key={`s${index}`} className={stylex.props(styles.bar, styles.darkSpeak).className} style={{ height }} />
      ))}
    </span>
  );
}

// The "How it works" page: what the app does and how a practice loop goes, from features it really has.
export function Landing({
  takeHeadingFocus,
  onStart,
  onOpenLesson,
}: {
  takeHeadingFocus: () => boolean;
  onStart: () => void;
  onOpenLesson: (id: string) => void;
}) {
  const { data: lessons } = useLessons();
  const preview = lessons?.slice(0, 3) ?? [];

  useEffect(() => {
    document.title = `How it works · ${APP_TITLE}`;
    return () => {
      document.title = APP_TITLE;
    };
  }, []);

  // In-page links would change the hash route, so "How it works" scrolls with a button instead.
  const showLoop = () => {
    const loop = document.getElementById("landing-loop");
    loop?.scrollIntoView({ behavior: "smooth", block: "start" });
    loop?.focus({ preventScroll: true });
  };

  return (
    <div className={stylex.props(styles.page).className}>
      <section aria-labelledby="landing-title" className={stylex.props(styles.hero).className}>
        <div className={stylex.props(styles.heroText).className}>
          <ul aria-label="The practice loop" className={stylex.props(styles.chips).className}>
            <li className={stylex.props(styles.chip, styles.listenChip).className}>LISTEN</li>
            <li className={stylex.props(styles.chip, styles.speakChip).className}>SAY IT BACK</li>
            <li className={stylex.props(styles.chip, styles.unlockChip).className}>UNLOCK</li>
          </ul>
          <h1
            id="landing-title"
            tabIndex={-1}
            className={stylex.props(styles.display).className}
            ref={(heading) => {
              if (heading && takeHeadingFocus()) heading.focus();
            }}
          >
            Listen. Say it back. <span className={stylex.props(styles.speakText).className}>Level up.</span>
          </h1>
          <p className={stylex.props(styles.lead).className}>
            Daily English practice for Vietnamese speakers. You don't just read along: you say every sentence back,
            and in Learn mode the next one opens only when you say this one clearly.
          </p>
          <div className={stylex.props(styles.actions).className}>
            <span className={stylex.props(styles.speakButton).className}>
              <Button label="Start practising" size="lg" variant="primary" onClick={onStart} />
            </span>
            <Button label="See how it works" size="lg" variant="secondary" onClick={showLoop} />
          </div>
          <p className={stylex.props(styles.muted).className}>Free. No account needed to start.</p>
        </div>

        <figure aria-label="Example: one sentence scored in Learn mode" className={stylex.props(styles.example).className} style={{ margin: 0 }}>
          <div className={stylex.props(styles.frame).className}>
            <div className={stylex.props(styles.frameTop).className}>
              <span className={stylex.props(styles.frameTag).className}>VIDEO LESSON</span>
              <span className={stylex.props(styles.frameTag).className}>LEARN MODE</span>
            </div>
            <div className={stylex.props(styles.caption).className}>
              <p className={stylex.props(styles.captionEn).className}>{EXAMPLE_SENTENCE}</p>
              <p lang="vi" className={stylex.props(styles.captionVi).className}>{EXAMPLE_VI}</p>
            </div>
          </div>
          <div className={stylex.props(styles.panel).className}>
            <div className={stylex.props(styles.panelRow).className}>
              <ScoreRing score={EXAMPLE.score} />
              <div>
                <p className={stylex.props(styles.eyebrow, EXAMPLE.passed ? styles.listenEyebrow : styles.speakEyebrow).className}>
                  {EXAMPLE.passed ? `Unlocked · ${EXAMPLE.score} points` : `Not yet · ${EXAMPLE.score} points`}
                </p>
                <p className={stylex.props(styles.muted).className}>Words in brackets are what the browser heard.</p>
              </div>
            </div>
            <ScoredWords result={EXAMPLE} />
          </div>
          <figcaption className={stylex.props(styles.muted).className}>An example result, as the app shows it.</figcaption>
        </figure>
      </section>

      <section
        id="landing-loop"
        tabIndex={-1}
        aria-labelledby="landing-loop-title"
        className={stylex.props(styles.section, styles.band).className}
      >
        <div className={stylex.props(styles.sectionHead).className}>
          <p className={stylex.props(styles.eyebrow, styles.listenEyebrow).className}>The practice loop</p>
          <h2 id="landing-loop-title" className={stylex.props(styles.h2).className}>
            No skimming. Every sentence gets said out loud.
          </h2>
          <p className={stylex.props(styles.muted).className}>
            Open a lesson, choose One at a time in Display, and switch to Learn. Each sentence waits for you.
          </p>
        </div>
        <ol className={stylex.props(styles.grid).className}>
          {STEPS.map((step, index) => (
            <li key={step.title} className={stylex.props(styles.step).className}>
              <div className={stylex.props(styles.stepTop).className}>
                <span aria-hidden="true" className={stylex.props(styles.stepIcon, stepIconStyles[step.style]).className}>
                  {step.icon ? <Icon>{step.icon}</Icon> : PASS_SCORE}
                </span>
                <span aria-hidden="true" className={stylex.props(styles.stepNumber).className}>
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className={stylex.props(styles.h3).className}>{step.title}</h3>
              <p className={stylex.props(styles.muted).className}>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="landing-scoring-title" className={stylex.props(styles.scoring).className}>
        <div className={stylex.props(styles.sectionHead).className}>
          <p className={stylex.props(styles.eyebrow, styles.speakEyebrow).className}>Word-by-word scoring</p>
          <h2 id="landing-scoring-title" className={stylex.props(styles.h2).className}>
            See exactly which word to fix
          </h2>
          <p className={stylex.props(styles.muted).className}>
            No vague "good job". Each word gets its own mark, and a word the browser heard differently shows what
            it heard. Each mark has its own underline, so it never depends on color alone.
          </p>
          <ul className={stylex.props(styles.legend).className}>
            <li className={stylex.props(styles.legendRow).className}>
              <span className={stylex.props(styles.legendWord, styles.good).className}>never</span>
              <span className={stylex.props(styles.muted).className}>Clear: {GOOD_SCORE} or more, double underline</span>
            </li>
            <li className={stylex.props(styles.legendRow).className}>
              <span className={stylex.props(styles.legendWord, styles.fair).className}>seen</span>
              <span className={stylex.props(styles.muted).className}>
                Close: {FAIR_SCORE} to {GOOD_SCORE - 1}, dotted underline
              </span>
            </li>
            <li className={stylex.props(styles.legendRow).className}>
              <span className={stylex.props(styles.legendWord, styles.miss).className}>anything</span>
              <span className={stylex.props(styles.muted).className}>Missed: under {FAIR_SCORE}, solid underline</span>
            </li>
          </ul>
        </div>
        <div className={stylex.props(styles.panel).className}>
          <p className={stylex.props(styles.eyebrow).className}>How the score works</p>
          <p className={stylex.props(styles.muted).className}>
            A matched word scores 100. A word heard as something else scores how close the spelling is. A missing
            word scores 0. The sentence score is the average, and {PASS_SCORE} unlocks the next sentence.
          </p>
          <p className={stylex.props(styles.muted).className}>
            Scoring uses your browser's speech recognition. In Chrome your voice may be sent to Google to be
            transcribed; nothing is sent to Road to English.
          </p>
        </div>
      </section>

      <section aria-labelledby="landing-features-title" className={stylex.props(styles.section, styles.band).className}>
        <div className={stylex.props(styles.sectionHead).className}>
          <p className={stylex.props(styles.eyebrow, styles.listenEyebrow).className}>Features</p>
          <h2 id="landing-features-title" className={stylex.props(styles.h2).className}>
            Everything you need to practise from real sentences
          </h2>
        </div>
        <ul className={stylex.props(styles.grid, styles.wideGrid).className}>
          {FEATURES.map((feature) => (
            <li key={feature.title} className={stylex.props(styles.feature).className}>
              <span className={stylex.props(feature.tone === "listen" ? styles.listenIcon : styles.speakIcon).className}>
                <Icon>{feature.icon}</Icon>
              </span>
              <h3 className={stylex.props(styles.h3).className}>{feature.title}</h3>
              <p className={stylex.props(styles.muted).className}>{feature.text}</p>
            </li>
          ))}
          <li className={stylex.props(styles.feature).className}>
            <span className={stylex.props(styles.speakIcon).className}>
              <Icon>
                <rect x="2.5" y="5" width="15" height="10" rx="2" />
                <path d="M6 12h8" />
              </Icon>
            </span>
            <h3 className={stylex.props(styles.h3).className}>Practise from the keyboard</h3>
            <ul aria-label="Keyboard shortcuts in One at a time" className={stylex.props(styles.keys).className}>
              {SHORTCUTS.map(([key, does]) => (
                <li key={key}>
                  <kbd className={stylex.props(styles.kbd).className}>{key}</kbd>
                  {does}
                </li>
              ))}
            </ul>
          </li>
        </ul>
      </section>

      {preview.length > 0 && (
        <section aria-labelledby="landing-library-title" className={stylex.props(styles.section).className}>
          <div className={stylex.props(styles.libraryHead).className}>
            <div className={stylex.props(styles.sectionHead).className}>
              <p className={stylex.props(styles.eyebrow, styles.listenEyebrow).className}>Lesson library</p>
              <h2 id="landing-library-title" className={stylex.props(styles.h2).className}>
                Start with a lesson at your level
              </h2>
            </div>
            <Button label="See all lessons" variant="ghost" onClick={onStart} />
          </div>
          <ul className={stylex.props(styles.grid, styles.wideGrid).className}>
            {preview.map((lesson) => (
              <li key={lesson.id} className={stylex.props(styles.lessonItem).className}>
                <LessonCard
                  title={lesson.title}
                  level={lesson.level}
                  sentenceCount={lesson.sentenceCount}
                  targetWpm={lesson.targetWpm}
                  completed={false}
                  onSelect={() => onOpenLesson(lesson.id)}
                  takeFocus={() => false}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="landing-cta-title" className={stylex.props(styles.cta).className}>
        <div className={stylex.props(styles.ctaText).className}>
          <h2 id="landing-cta-title" className={stylex.props(styles.h2, styles.ctaTitle).className}>
            Your first sentence is waiting.
          </h2>
          <p className={stylex.props(styles.ctaLead).className}>
            Free to use. Progress is saved on this device; sign in any time to sync it.
          </p>
        </div>
        <div className={stylex.props(styles.ctaActions).className}>
          <Bars />
          <span className={stylex.props(styles.ctaButton).className}>
            <Button label="Start practising" size="lg" variant="primary" onClick={onStart} />
          </span>
        </div>
      </section>
    </div>
  );
}
