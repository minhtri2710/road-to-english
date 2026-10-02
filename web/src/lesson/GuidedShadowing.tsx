import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { Status } from "../components/feedback";
import { PASS_SCORE } from "../lib/shadowScore";

const STEPS = [
  "Listen to the sentence.",
  "Shadow along with the text.",
  "Record yourself and compare.",
  "Hide the text and shadow again.",
  "Go to the next sentence.",
];

const LEARN_STEPS = [
  "Listen to the sentence.",
  "Say it back with the round speak button.",
  `Reach ${PASS_SCORE} points to unlock the next sentence.`,
  "Not there yet? Listen slowly and try again, or use a skip.",
];

// Keys that act while focus is inside the guided view, and the control each one presses.
const SHORTCUTS: { key: string; label: string; does: string; target: string }[] = [
  { key: "l", label: "L", does: "listen", target: "listen" },
  { key: "r", label: "R", does: "speak or record", target: "speak" },
  { key: "s", label: "S", does: "listen slowly", target: "slow" },
  { key: "ArrowLeft", label: "←", does: "previous", target: "previous" },
  { key: "ArrowRight", label: "→", does: "next", target: "next" },
];

export const SKIPS_PER_LESSON = 3;

const styles = stylex.create({
  practiceMode: {
    alignSelf: "start",
  },
  kbdRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--spacing-1) var(--spacing-3)",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
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
});

// Typing in a field, or arrows in a radio group or menu, keep their own meaning.
function ownsKey(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("input, textarea, select, [contenteditable='true']")) return true;
  return key.startsWith("Arrow") && target.closest("[role='radio'], [role='radiogroup'], [role='menu'], [role='slider'], audio") !== null;
}

export interface GateState {
  // Learn mode can be turned on: speech recognition is supported and Pronunciation check is on.
  available: boolean;
  on: boolean;
  setOn: (on: boolean) => void;
  // The current sentence passed or was skipped this visit.
  passed: boolean;
  skipsLeft: number;
  skip: () => void;
}

// One sentence at a time: its heading, a fixed step guide, the sentence's card and Previous/Next.
// In Learn mode, Next stays locked until the sentence passes Shadow Gate or is skipped.
export function GuidedShadowing({
  index,
  count,
  step,
  gate,
  children,
}: {
  index: number;
  count: number;
  step: (index: number) => void;
  gate: GateState;
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
  const last = index === count - 1;
  const locked = gate.on && !gate.passed && !last;

  // Shortcuts press the matching enabled control in this view, so they do only what a click could.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const shortcut = SHORTCUTS.find((entry) => entry.key === key);
    if (!shortcut || ownsKey(event.target, key)) return;
    const targets = shortcut.target === "speak" ? ["speak", "record"] : [shortcut.target];
    for (const target of targets) {
      const control = event.currentTarget.querySelector<HTMLButtonElement>(`[data-shortcut="${target}"]`);
      if (control && !control.disabled && control.getAttribute("aria-disabled") !== "true") {
        event.preventDefault();
        control.click();
        return;
      }
    }
  };

  return (
    <div onKeyDown={onKeyDown}>
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
        <VStack gap={1}>
          <SegmentedControl
            label="Practice mode"
            xstyle={styles.practiceMode}
            value={gate.on ? "learn" : "free"}
            isDisabled={!gate.available}
            disabledMessage="Turn on Pronunciation check in Display to use Learn mode"
            onChange={(value) => gate.setOn(value === "learn")}
          >
            <SegmentedControlItem value="free" label="Free" />
            <SegmentedControlItem value="learn" label="Learn" />
          </SegmentedControl>
          {!gate.available && (
            <Text as="p" type="supporting">
              Learn mode locks each next sentence until you say this one clearly. Turn on Pronunciation check in
              Display to use it.
            </Text>
          )}
        </VStack>
        <VStack as="ol" gap={0}>
          {(gate.on ? LEARN_STEPS : STEPS).map((text) => (
            <li key={text}>
              <Text>{text}</Text>
            </li>
          ))}
        </VStack>
        {children}
        <HStack gap={1} wrap="wrap" align="center">
          <Button
            label="Previous"
            variant="secondary"
            data-shortcut="previous"
            isDisabled={index === 0}
            // A tooltip makes Astryx use aria-disabled, so the pressed button keeps keyboard focus.
            tooltip={index === 0 ? "This is the first sentence" : undefined}
            onClick={() => go(index - 1)}
          />
          <Button
            label="Next"
            variant={gate.on && gate.passed && !last ? "primary" : "secondary"}
            data-shortcut="next"
            isDisabled={last || locked}
            tooltip={last ? "This is the last sentence" : locked ? `Reach ${PASS_SCORE} points or skip to unlock` : undefined}
            onClick={() => go(index + 1)}
          />
          {gate.on && !last && !gate.passed && (
            <Button
              label={`Skip (${gate.skipsLeft} of ${SKIPS_PER_LESSON} left)`}
              variant="ghost"
              isDisabled={gate.skipsLeft === 0}
              tooltip={gate.skipsLeft === 0 ? "No skips left in this lesson" : undefined}
              onClick={() => {
                gate.skip();
                go(index + 1);
              }}
            />
          )}
        </HStack>
        <VStack gap={0.5}>
          <Text type="supporting" id="guided-shortcuts">
            Keyboard, while you work in this sentence:
          </Text>
          <ul aria-labelledby="guided-shortcuts" className={stylex.props(styles.kbdRow).className}>
            {SHORTCUTS.map((shortcut) => (
              <li key={shortcut.key}>
                <Text type="supporting">
                  <kbd className={stylex.props(styles.kbd).className}>{shortcut.label}</kbd>
                  {shortcut.does}
                </Text>
              </li>
            ))}
          </ul>
        </VStack>
        <VisuallyHidden>
          <Status>{announcement}</Status>
        </VisuallyHidden>
      </VStack>
    </div>
  );
}
