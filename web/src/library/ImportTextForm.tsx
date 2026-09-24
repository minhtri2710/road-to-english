import { useRef, useState, type FormEvent } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { Lesson, Level } from "../api/lessons";
import { Alert } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import { createUserLesson, USER_LEVELS, USER_WPMS } from "../lib/userLessons";

const styles = stylex.create({
  importTextArea: {
    width: "100%",
    minHeight: "8rem",
    padding: "0.5rem 0.75rem",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-surface)",
    color: "var(--color-text-primary)",
    font: "inherit",
  },
});

export function ImportTextForm({ onCreate }: { onCreate: (lesson: Lesson) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [level, setLevel] = useState<Level>("B1");
  const [targetWpm, setTargetWpm] = useState<(typeof USER_WPMS)[number]>("110");
  const [error, setError] = useState<string | null>(null);
  const isCreatingRef = useRef(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isCreatingRef.current) {
      return;
    }

    isCreatingRef.current = true;
    try {
      await onCreate(createUserLesson({ title, text, level, targetWpm: Number(targetWpm), videoUrl: videoUrl.trim() }));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create lesson.");
    } finally {
      isCreatingRef.current = false;
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <VStack gap={1}>
        <Heading level={2}>Import text</Heading>
        <Text as="p" type="supporting">
          Your lessons stay on this device; export a backup to move them.
        </Text>
        <label htmlFor="import-title">
          <Text as="span" type="supporting">Title</Text>
        </label>
        <input
          id="import-title"
          className={stylex.props(sharedStyles.dictationInput).className}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label htmlFor="import-video">
          <Text as="span" type="supporting">YouTube URL</Text>
        </label>
        <input
          id="import-video"
          type="url"
          className={stylex.props(sharedStyles.dictationInput).className}
          value={videoUrl}
          onChange={(event) => setVideoUrl(event.target.value)}
        />
        <label htmlFor="import-text">
          <Text as="span" type="supporting">Text</Text>
        </label>
        <textarea
          id="import-text"
          className={stylex.props(styles.importTextArea).className}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <HStack gap={1} align="center" xstyle={sharedStyles.shadowingControls}>
          <ToggleButtonGroup
            label="Level"
            value={level}
            onChange={(nextLevel) => {
              if (nextLevel) {
                setLevel(nextLevel as Level);
              }
            }}
          >
            {USER_LEVELS.map((value) => (
              <ToggleButton key={value} value={value} label={value} />
            ))}
          </ToggleButtonGroup>
          <ToggleButtonGroup
            label="Target WPM"
            value={targetWpm}
            xstyle={sharedStyles.shadowingControls}
            onChange={(nextWpm) => {
              if (nextWpm) {
                setTargetWpm(nextWpm as (typeof USER_WPMS)[number]);
              }
            }}
          >
            {USER_WPMS.map((value) => (
              <ToggleButton key={value} value={value} label={`${value} WPM`} />
            ))}
          </ToggleButtonGroup>
        </HStack>
        <Button label="Create" variant="primary" type="submit" />
        {error && <Alert>{error}</Alert>}
        <Text as="p" type="supporting">
          Paste the transcript from YouTube's Show transcript panel (timestamps included).
        </Text>
      </VStack>
    </form>
  );
}
