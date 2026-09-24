import { useRef, useState, type FormEvent, type RefObject } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { Status } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import { blankFor, blankMatches, diffWords, type WordDiff } from "../lib/dictation";
import { speak, speechSupported } from "../lib/speech";

const styles = stylex.create({
  wordCorrect: {
    color: "var(--color-success)",
  },
});

export type PracticeMode = "recording" | "check" | "dictation" | "blank";

function wordLabel(entry: WordDiff, verb: "typed" | "said"): string {
  switch (entry.kind) {
    case "correct":
      return entry.word;
    case "missed":
      return `${entry.word} (missed)`;
    case "replaced":
      return `${entry.word} (you ${verb} "${entry.typed}")`;
    case "extra":
      return `${entry.typed} (extra)`;
  }
}

export function WordDiffResult({
  text,
  answer,
  verb,
  notes,
}: {
  text: string;
  answer: string;
  verb: "typed" | "said";
  notes?: string;
}) {
  const diff = diffWords(answer, text);
  return (
    <VStack gap={1}>
      <Text as="p">Reference: {text}</Text>
      <Text as="p">
        You {verb}: {answer}
      </Text>
      <Text as="p">
        {diff.map((entry, index) => (
          <Text
            key={index}
            as="span"
            color="primary"
            xstyle={entry.kind === "correct" ? styles.wordCorrect : sharedStyles.error}
          >
            {index > 0 && " "}
            {wordLabel(entry, verb)}
          </Text>
        ))}
      </Text>
      {notes && <Text as="p" type="supporting">{notes}</Text>}
      <Text as="p" weight="semibold">
        {diff.every((entry) => entry.kind === "correct") ? "Correct" : "Not quite"}
      </Text>
    </VStack>
  );
}

interface QuizProps {
  id: string;
  text: string;
  targetWpm: number;
  speed: number;
  practice: (mode: PracticeMode) => void;
  stopMedia: () => void;
}

function PlayButton({ text, targetWpm, speed, stopMedia }: Omit<QuizProps, "id" | "practice">) {
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
}: {
  id: string;
  label: string;
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
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
        <Button label="Check" variant="primary" type="submit" />
      </VStack>
    </form>
  );
}

export function SentenceDictation({ id, text, notes, targetWpm, speed, practice, stopMedia }: QuizProps & { notes?: string }) {
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const checkAnswer = () => {
    setChecked(typed);
    if (typed.trim()) {
      practice("dictation");
    }
  };

  // Try again removes itself, so focus goes back to the answer field.
  const tryAgain = () => {
    setTyped("");
    setChecked(null);
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
      <Status>
        {checked !== null && (
          <WordDiffResult text={text} answer={checked} verb="typed" notes={notes} />
        )}
      </Status>
      {checked !== null && <Button label="Try again" variant="ghost" onClick={tryAgain} />}
    </VStack>
  );
}

export function SentenceBlank({ id, text, targetWpm, speed, practice, stopMedia }: QuizProps) {
  const [typed, setTyped] = useState("");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { parts, index, answer } = blankFor(text);

  if (index === -1) {
    return <Text as="p">{text}</Text>;
  }

  const checkAnswer = () => {
    setCorrect(blankMatches(typed, answer));
    if (typed.trim()) {
      practice("blank");
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
        {parts.map((part, i) => (i === index ? "____" : part)).join("")}
      </Text>
      <PlayButton text={text} targetWpm={targetWpm} speed={speed} stopMedia={stopMedia} />
      <AnswerForm
        id={`blank-${id}`}
        label="Which word fills the blank?"
        inputRef={inputRef}
        value={typed}
        onChange={setTyped}
        onSubmit={checkAnswer}
      />
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
