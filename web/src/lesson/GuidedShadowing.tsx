import { useRef, useState, type ReactNode } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";

import { Status } from "../components/feedback";

const STEPS = [
  "Listen to the sentence.",
  "Shadow along with the text.",
  "Record yourself and compare.",
  "Hide the text and shadow again.",
  "Go to the next sentence.",
];

// One sentence at a time: its heading, a fixed step guide, the sentence's card and Previous/Next.
export function GuidedShadowing({
  index,
  count,
  step,
  children,
}: {
  index: number;
  count: number;
  step: (index: number) => void;
  children: ReactNode;
}) {
  const position = `Sentence ${index + 1} of ${count}`;
  const [announcement, setAnnouncement] = useState("");
  const headingFocus = useRef(false);
  const go = (next: number) => {
    headingFocus.current = true;
    setAnnouncement(`Sentence ${next + 1} of ${count}`);
    step(next);
  };

  return (
    <VStack gap={2}>
      <Heading
        level={2}
        tabIndex={-1}
        ref={(heading) => {
          if (heading && headingFocus.current) {
            headingFocus.current = false;
            heading.focus();
          }
        }}
      >
        {position}
      </Heading>
      <VStack as="ol" gap={0}>
        {STEPS.map((text) => (
          <li key={text}>
            <Text>{text}</Text>
          </li>
        ))}
      </VStack>
      {children}
      <HStack gap={1}>
        <Button
          label="Previous"
          variant="secondary"
          isDisabled={index === 0}
          // A tooltip makes Astryx use aria-disabled, so the pressed button keeps keyboard focus.
          tooltip={index === 0 ? "This is the first sentence" : undefined}
          onClick={() => go(index - 1)}
        />
        <Button
          label="Next"
          variant="secondary"
          isDisabled={index === count - 1}
          tooltip={index === count - 1 ? "This is the last sentence" : undefined}
          onClick={() => go(index + 1)}
        />
      </HStack>
      <VisuallyHidden>
        <Status>{announcement}</Status>
      </VisuallyHidden>
    </VStack>
  );
}
