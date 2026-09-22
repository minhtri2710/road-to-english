import { useEffect, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Theme } from "@astryxdesign/core/theme";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import * as stylex from "@stylexjs/stylex";

import { NotFoundError } from "./api/lessons";
import { useLesson, useLessons } from "./hooks/lessons";
import { useRecorder } from "./hooks/useRecorder";

import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";

// ponytail: 180 WPM is a heuristic rate-one mapping; speech engines vary, so tune this constant if calibration changes.
const WPM_AT_RATE_ONE = 180;

const appStyles = stylex.create({
  page: {
    minHeight: "100vh",
    padding: "2rem",
    backgroundColor: "var(--color-background-body)",
    color: "var(--color-text-primary)",
  },
  content: {
    width: "100%",
    maxWidth: "48rem",
    marginInline: "auto",
  },
  header: {
    marginBottom: "2rem",
  },
  lessonButton: {
    width: "100%",
    justifyContent: "space-between",
    textAlign: "start",
  },
  sentence: {
    padding: "1rem",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-surface)",
  },
  error: {
    color: "var(--color-error)",
  },
  shadowingControls: {
    flexWrap: "wrap",
  },
});

function speak(text: string, targetWpm: number): void {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = Math.min(2, Math.max(0.5, targetWpm / WPM_AT_RATE_ONE));
  window.speechSynthesis.speak(utterance);
}

function SentenceShadowing({
  text,
  targetWpm,
}: {
  text: string;
  targetWpm: number;
}) {
  const recorder = useRecorder();
  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const recordingSupported =
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof URL.createObjectURL === "function";

  return (
    <VStack gap={1}>
      <HStack gap={1} xstyle={appStyles.shadowingControls}>
        <Button
          label="Listen"
          variant="secondary"
          isDisabled={!speechSupported}
          onClick={() => speak(text, targetWpm)}
        />
        <Button
          label={recorder.state === "recording" ? "Stop" : "Record"}
          variant="secondary"
          isDisabled={!recordingSupported || recorder.state === "requesting"}
          isLoading={recorder.state === "requesting"}
          onClick={
            recorder.state === "recording"
              ? recorder.stopRecording
              : recorder.startRecording
          }
        />
      </HStack>
      {!speechSupported && (
        <Text as="p" type="supporting">
          Listen disabled: speech synthesis is not supported in this browser.
        </Text>
      )}
      {!recordingSupported && (
        <Text as="p" type="supporting">
          Recording disabled: microphone recording is not supported in this browser.
        </Text>
      )}
      {recorder.error && (
        <Text as="p" color="primary" xstyle={appStyles.error}>
          {recorder.error}
        </Text>
      )}
      {recorder.url && <audio controls src={recorder.url} />}
    </VStack>
  );
}

function ErrorMessage({ error, subject }: { error: Error; subject: string }) {
  const message = error instanceof NotFoundError ? "not found" : error.message;

  return (
    <Text as="p" color="primary" xstyle={appStyles.error}>
      Unable to load {subject}: {message}
    </Text>
  );
}

function LessonList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data, loading, error } = useLessons();

  if (loading) {
    return <Text as="p">Loading lessons...</Text>;
  }

  if (error) {
    return <ErrorMessage error={error} subject="lessons" />;
  }

  if (!data || data.length === 0) {
    return <Text as="p">No lessons available.</Text>;
  }

  return (
    <VStack as="ul" gap={2} padding={0}>
      {data.map((lesson) => (
        <li key={lesson.id}>
          <Button
            label={lesson.title}
            variant="secondary"
            xstyle={appStyles.lessonButton}
            onClick={() => onSelect(lesson.id)}
          >
            <HStack justify="between" align="center" width="100%">
              <VStack gap={0.5} align="start">
                <Text weight="semibold">{lesson.title}</Text>
                <Text type="supporting">
                  {lesson.level} · {lesson.sentenceCount} sentences
                </Text>
              </VStack>
              <Badge label={`${lesson.targetWpm} WPM`} variant="info" />
            </HStack>
          </Button>
        </li>
      ))}
    </VStack>
  );
}

function LessonDetail({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const { data, loading, error } = useLesson(id);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  if (loading) {
    return <Text as="p">Loading lesson...</Text>;
  }

  if (error) {
    return (
      <VStack gap={3}>
        <ErrorMessage error={error} subject="lesson" />
        <Button label="Back to lessons" variant="ghost" onClick={onBack} />
      </VStack>
    );
  }

  if (!data) {
    return <Text as="p">Lesson unavailable.</Text>;
  }

  return (
    <VStack gap={4}>
      <HStack justify="between" align="center">
        <Button label="Back to lessons" variant="ghost" onClick={onBack} />
        <Badge label={`${data.targetWpm} WPM`} variant="info" />
      </HStack>
      <VStack gap={1}>
        <Heading level={2}>{data.title}</Heading>
        <Text type="supporting">Level {data.level}</Text>
      </VStack>
      <VStack as="ol" gap={2} padding={0}>
        {data.sentences.map((sentence) => (
          <li key={sentence.id}>
            <Card padding={3} xstyle={appStyles.sentence}>
              <VStack gap={1}>
                <Text as="p">{sentence.text}</Text>
                {sentence.notes && (
                  <Text as="p" type="supporting">
                    {sentence.notes}
                  </Text>
                )}
                <SentenceShadowing
                  text={sentence.text}
                  targetWpm={data.targetWpm}
                />
              </VStack>
            </Card>
          </li>
        ))}
      </VStack>
    </VStack>
  );
}

export function App() {
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);

  return (
    <Theme theme={neutralTheme}>
      <main className={stylex.props(appStyles.page).className}>
        <div className={stylex.props(appStyles.content).className}>
          <VStack gap={4}>
            <VStack gap={1} xstyle={appStyles.header}>
              <Heading level={1}>Lesson library</Heading>
              <Text type="large">
                Choose a lesson to practise reading and speaking.
              </Text>
            </VStack>
            {selectedLessonId === null ? (
              <LessonList onSelect={setSelectedLessonId} />
            ) : (
              <LessonDetail
                id={selectedLessonId}
                onBack={() => setSelectedLessonId(null)}
              />
            )}
          </VStack>
        </div>
      </main>
    </Theme>
  );
}
