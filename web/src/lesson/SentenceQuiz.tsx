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

const styles = stylex.create({
  wordCorrect: {
    color: "var(--color-success)",
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
      return " (missed)";
    case "replaced":
      return ` (you ${verb} "${entry.typed}")`;
    case "extra":
      return " (extra)";
  }
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
}: {
  text: string;
  answer: string;
  verb: "typed" | "said";
  notes?: string;
  targetWpm: number;
  speed: number;
  stopMedia: () => void;
}) {
  const diff = diffWords(answer, text);
  const total = diff.filter((entry) => entry.kind !== "extra").length;
  const matched = diff.filter((entry) => entry.kind === "correct").length;
  const endings = endingHints(diff);
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
        aria-label={`Hear ${entry.word}`}
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
          <Text as="p">What the browser heard: {answer}</Text>
          <Text as="p" weight="semibold">The browser matched {matched} of {total} words</Text>
        </>
      ) : (
        <Text as="p" weight="semibold">
          {matched === diff.length
            ? `Correct: ${total} of ${total} words`
            : `Not quite: ${matched} of ${total} words matched`}
        </Text>
      )}
      <Text as="p">Reference: {text}</Text>
      <Text as="p">
        {diff.map((entry, index) => (
          <Text
            key={index}
            as="span"
            color="primary"
            xstyle={entry.kind === "correct" ? styles.wordCorrect : sharedStyles.error}
          >
            {index > 0 && " "}
            {wordContent(entry)}
            {wordNote(entry, verb)}
          </Text>
        ))}
      </Text>
      {endings.length > 0 && (
        <Text as="p" type="supporting">
          Check the ending sound: {endings.join(", ")}
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
  const supported = speechSupported();
  return (
    <>
      <Button
        label="Play"
        variant="secondary"
        isDisabled={!supported}
        onClick={() => {
          stopMedia();
          speak(text, targetWpm, speed);
        }}
      />
      {!supported && (
        <Text as="p" type="supporting">
          Play disabled: speech synthesis is not supported in this browser.
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
        <Button label="Check" variant="primary" type="submit" />
      </VStack>
    </form>
  );
}

export function SentenceDictation({ id, text, notes, targetWpm, speed, practice, miss, stopMedia }: QuizProps & { notes?: string }) {
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const checkAnswer = () => {
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
        label="What did you hear?"
        inputRef={inputRef}
        value={typed}
        onChange={setTyped}
        onSubmit={checkAnswer}
      />
      <Button
        label={showHint ? "Hide hint" : "Show hint"}
        variant="ghost"
        aria-expanded={showHint}
        aria-controls={hintId}
        onClick={() => setShowHint((shown) => !shown)}
      />
      {showHint && <Text as="p" id={hintId}>Hint: {hintFor(text)}</Text>}
      <Status>
        {checked !== null && (
          <WordDiffResult
            text={text}
            answer={checked}
            verb="typed"
            notes={notes}
            targetWpm={targetWpm}
            speed={speed}
            stopMedia={stopMedia}
          />
        )}
      </Status>
      {checked !== null && <Button label="Try again" variant="ghost" onClick={tryAgain} />}
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
  const [typed, setTyped] = useState("");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { parts, index, answer } = blankFor(text);

  if (index === -1) {
    return <Text as="p">{text}</Text>;
  }

  const choices = lessonWords ? wordBank(parts[index], lessonWords, id) : [];

  const checkAnswer = () => {
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
              <VisuallyHidden>blank</VisuallyHidden>
            </Fragment>
          ) : (
            part
          ),
        )}
      </Text>
      <PlayButton text={text} targetWpm={targetWpm} speed={speed} stopMedia={stopMedia} />
      <AnswerForm
        id={`blank-${id}`}
        label="Which word fills the blank?"
        inputRef={inputRef}
        value={typed}
        onChange={setTyped}
        onSubmit={checkAnswer}
      >
        {choices.length > 0 && (
          <VStack gap={1} role="group" aria-labelledby={`bank-${id}`}>
            <Text as="span" type="supporting" id={`bank-${id}`}>
              Choose a word
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
          <Text as="p" weight="semibold">
            {correct ? "Correct" : `Not quite — the word was ${parts[index]}`}
          </Text>
        )}
      </Status>
      {correct !== null && <Button label="Try again" variant="ghost" onClick={tryAgain} />}
    </VStack>
  );
}
