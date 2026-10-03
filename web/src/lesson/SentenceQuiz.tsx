import { Fragment, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { Status } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import type { PracticeMode } from "../lib/progress";
import { blankFor, blankMatches, diffWords, endingHints, hintFor, wordBank, type WordDiff } from "../lib/dictation";
import { speak, speechSupported } from "../lib/speech";
import { tr, useT } from "../i18n";

const correctAnimation = stylex.keyframes({
  from: { transform: "scale(0.4)", opacity: 0 },
  to: { transform: "scale(1)", opacity: 1 },
});
const nudgeAnimation = stylex.keyframes({
  "0%, 100%": { transform: "translateX(0)" },
  "25%, 75%": { transform: "translateX(-4px)" },
  "50%": { transform: "translateX(4px)" },
});

const styles = stylex.create({
  result: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "1.5em",
    paddingInline: "var(--spacing-1)",
    marginInlineStart: "calc(-1 * var(--spacing-1))",
    borderRadius: "var(--radius-element)",
  },
  correctMark: {
    display: "inline-block",
    width: "1.25em",
    height: "1.25em",
    flex: "0 0 1.25em",
    color: "var(--color-success)",
    transformOrigin: "center",
    animationName: correctAnimation,
    animationDuration: "var(--duration-fast)",
    animationTimingFunction: "var(--rte-ease-emphasized)",
    animationIterationCount: 1,
  },
  wrongResult: {
    animationName: nudgeAnimation,
    animationDuration: "var(--duration-medium)",
    animationTimingFunction: "var(--ease-standard)",
    animationIterationCount: 1,
  },
  wordCorrect: {
    color: "var(--color-success)",
  },
  wordFeedback: {
    backgroundColor: "var(--color-success-muted)",
    borderRadius: "var(--radius-element)",
    transitionProperty: "background-color",
    transitionDuration: "var(--duration-fast)",
  },
  hearWord: {
    textDecorationLine: "underline",
    textUnderlineOffset: "0.2em",
  },
});

function wordNote(entry: WordDiff, verb: "typed" | "said"): string {
  switch (entry.kind) {
    case "correct":
      return "";
    case "missed":
      return " " + tr("(missed)");
    case "replaced":
      return " " + (verb === "typed" ? tr('(you typed "{word}")', { word: entry.typed }) : tr('(you said "{word}")', { word: entry.typed }));
    case "extra":
      return " " + tr("(extra)");
  }
}

function CorrectMark() {
  return (
    <span aria-hidden="true" data-motion="answer-correct" className={stylex.props(styles.correctMark).className}>
      <svg viewBox="0 0 16 16" width="100%" height="100%" focusable="false">
        <path d="m3 8 3 3 7-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      </svg>
    </span>
  );
}

// Missed and replaced reference words are buttons that speak the word when speech is supported.
export function WordDiffResult({
  text,
  answer,
  verb,
  notes,
  targetWpm,
  speed,
  stopMedia,
  checkId,
}: {
  text: string;
  answer: string;
  verb: "typed" | "said";
  notes?: string;
  checkId: number;
  targetWpm: number;
  speed: number;
  stopMedia: () => void;
}) {
  const t = useT();
  const diff = diffWords(answer, text);
  const total = diff.filter((entry) => entry.kind !== "extra").length;
  const matched = diff.filter((entry) => entry.kind === "correct").length;
  const endings = endingHints(diff);
  const correct = diff.length > 0 && diff.every((entry) => entry.kind === "correct");
  const canSpeak = speechSupported();
  const wordContent = (entry: WordDiff) => {
    if (entry.kind === "extra") {
      return entry.typed;
    }
    if (!canSpeak || entry.kind === "correct") {
      return entry.word;
    }
    return (
      <Button
        label={entry.word}
        aria-label={t("Hear {word}", { word: entry.word })}
        size="sm"
        variant="ghost"
        xstyle={styles.hearWord}
        onClick={() => {
          stopMedia();
          speak(entry.word, targetWpm, speed);
        }}
      />
    );
  };
  return (
    <VStack gap={1}>
      {verb === "said" ? (
        <>
          <Text as="p">{t("What the browser heard: {answer}", { answer })}</Text>
          <Text as="p" weight="semibold" xstyle={[styles.result, !correct && styles.wrongResult]} key={checkId} data-motion={correct ? "answer-correct" : "answer-nudge"}>
            {correct && <CorrectMark />}
            {t("The browser matched {matched} of {total} words", { matched, total })}
          </Text>
        </>
      ) : (
        <Text as="p" weight="semibold" xstyle={[styles.result, !correct && styles.wrongResult]} key={checkId} data-motion={correct ? "answer-correct" : "answer-nudge"}>
          {correct && <CorrectMark />}
          {correct
            ? t("Correct: {total} of {total} words", { total })
            : t("Not quite: {matched} of {total} words matched", { matched, total })}
        </Text>
      )}
      <Text as="p">{t("Reference: {text}", { text })}</Text>
      <Text as="p">
        {diff.map((entry, index) => (
          <Fragment key={index}>
            {index > 0 && " "}
            <Text
              as="span"
              color="primary"
              data-feedback={entry.kind === "correct" ? "correct-word" : undefined}
              xstyle={[
                entry.kind === "correct" ? styles.wordCorrect : sharedStyles.error,
                entry.kind === "correct" && styles.wordFeedback,
              ]}
            >
              {wordContent(entry)}
              {wordNote(entry, verb)}
            </Text>
          </Fragment>
        ))}
      </Text>
      {endings.length > 0 && (
        <Text as="p" type="supporting">
          {t("Check the ending sound: {words}", { words: endings.join(", ") })}
        </Text>
      )}
      {notes && <Text as="p" type="supporting">{notes}</Text>}
    </VStack>
  );
}

interface QuizProps {
  id: string;
  text: string;
  targetWpm: number;
  speed: number;
  practice: (mode: PracticeMode) => void;
  // Reports the whole written reference words that a checked answer missed.
  miss: (words: string[]) => void;
  stopMedia: () => void;
}

function PlayButton({ text, targetWpm, speed, stopMedia }: Omit<QuizProps, "id" | "practice" | "miss">) {
  const t = useT();
  const supported = speechSupported();
  return (
    <>
      <Button
        label={t("Play")}
        variant="secondary"
        isDisabled={!supported}
        onClick={() => {
          stopMedia();
          speak(text, targetWpm, speed);
        }}
      />
      {!supported && (
        <Text as="p" type="supporting">
          {t("Play disabled: speech synthesis is not supported in this browser.")}
        </Text>
      )}
    </>
  );
}

function AnswerForm({
  id,
  label,
  inputRef,
  value,
  onChange,
  onSubmit,
  children,
}: {
  id: string;
  label: string;
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  // Rendered between the input and Check.
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <VStack gap={1}>
        <label htmlFor={id}>
          <Text as="span" type="supporting">
            {label}
          </Text>
        </label>
        <input
          ref={inputRef}
          id={id}
          className={stylex.props(sharedStyles.dictationInput).className}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {children}
        <Button label={t("Check")} variant="primary" type="submit" />
      </VStack>
    </form>
  );
}

export function SentenceDictation({ id, text, notes, targetWpm, speed, practice, miss, stopMedia }: QuizProps & { notes?: string }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const [checkId, setCheckId] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const checkAnswer = () => {
    setCheckId((current) => current + 1);
    setChecked(typed);
    if (typed.trim()) {
      practice("dictation");
      miss(diffWords(typed, text).flatMap((entry) => (entry.kind === "missed" || entry.kind === "replaced" ? [entry.written] : [])));
    }
  };

  // Try again removes itself, so focus goes back to the answer field.
  const tryAgain = () => {
    setTyped("");
    setChecked(null);
    setShowHint(false);
    inputRef.current?.focus();
  };

  return (
    <VStack gap={1}>
      <PlayButton text={text} targetWpm={targetWpm} speed={speed} stopMedia={stopMedia} />
      <AnswerForm
        id={`dictation-${id}`}
        label={t("What did you hear?")}
        inputRef={inputRef}
        value={typed}
        onChange={setTyped}
        onSubmit={checkAnswer}
      />
      <Button
        label={showHint ? t("Hide hint") : t("Show hint")}
        variant="ghost"
        aria-expanded={showHint}
        aria-controls={hintId}
        onClick={() => setShowHint((shown) => !shown)}
      />
      {showHint && <Text as="p" id={hintId}>{t("Hint: {hint}", { hint: hintFor(text) })}</Text>}
      <Status>
        {checked !== null && (
          <WordDiffResult
            text={text}
            answer={checked}
            verb="typed"
            checkId={checkId}
            notes={notes}
            targetWpm={targetWpm}
            speed={speed}
            stopMedia={stopMedia}
          />
        )}
      </Status>
      {checked !== null && <Button label={t("Try again")} variant="ghost" onClick={tryAgain} />}
    </VStack>
  );
}

// lessonWords (card words of the whole lesson) turns on the word bank.
export function SentenceBlank({
  id,
  text,
  targetWpm,
  speed,
  practice,
  miss,
  stopMedia,
  lessonWords,
}: QuizProps & { lessonWords?: string[] }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [checkId, setCheckId] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { parts, index, answer } = blankFor(text);

  if (index === -1) {
    return <Text as="p">{text}</Text>;
  }

  const choices = lessonWords ? wordBank(parts[index], lessonWords, id) : [];

  const checkAnswer = () => {
    setCheckId((current) => current + 1);
    const matches = blankMatches(typed, answer);
    setCorrect(matches);
    if (typed.trim()) {
      practice("blank");
      if (!matches) {
        miss([parts[index]]);
      }
    }
  };

  // Try again removes itself, so focus goes back to the answer field.
  const tryAgain = () => {
    setTyped("");
    setCorrect(null);
    inputRef.current?.focus();
  };

  return (
    <VStack gap={1}>
      <Text as="p">
        {parts.map((part, i) =>
          i === index ? (
            <Fragment key={i}>
              <span aria-hidden="true">____</span>
              <VisuallyHidden>{t("blank")}</VisuallyHidden>
            </Fragment>
          ) : (
            part
          ),
        )}
      </Text>
      <PlayButton text={text} targetWpm={targetWpm} speed={speed} stopMedia={stopMedia} />
      <AnswerForm
        id={`blank-${id}`}
        label={t("Which word fills the blank?")}
        inputRef={inputRef}
        value={typed}
        onChange={setTyped}
        onSubmit={checkAnswer}
      >
        {choices.length > 0 && (
          <VStack gap={1} role="group" aria-labelledby={`bank-${id}`}>
            <Text as="span" type="supporting" id={`bank-${id}`}>
              {t("Choose a word")}
            </Text>
            <HStack gap={1} xstyle={sharedStyles.shadowingControls}>
              {choices.map((choice) => (
                <Button
                  key={choice}
                  label={choice}
                  variant="secondary"
                  onClick={() => {
                    setTyped(choice);
                    inputRef.current?.focus();
                  }}
                />
              ))}
            </HStack>
          </VStack>
        )}
      </AnswerForm>
      <Status>
        {correct !== null && (
          <Text
            as="p"
            weight="semibold"
            xstyle={[styles.result, correct ? undefined : styles.wrongResult]}
            key={checkId}
            data-motion={correct ? "answer-correct" : "answer-nudge"}
          >
            {correct && <CorrectMark />}
            {correct ? t("Correct") : t("Not quite — the word was {word}", { word: parts[index] })}
          </Text>
        )}
      </Status>
      {correct !== null && <Button label={t("Try again")} variant="ghost" onClick={tryAgain} />}
    </VStack>
  );
}
