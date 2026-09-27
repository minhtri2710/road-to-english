import { useId, useRef, useState } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Link } from "@astryxdesign/core/Link";
import { HStack } from "@astryxdesign/core/HStack";
import { useToast } from "@astryxdesign/core/Toast";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { Alert, Status } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import { lookupWord, type Definition } from "../lib/dictionary";
import { speechSupported } from "../lib/speech";
import { intonation, wordStress, type StressDict } from "../lib/stress";
import { cardId, type NewCard, type VocabCard } from "../lib/vocab";
import { cardWord, isCardWord, splitWords } from "../lib/words";

const styles = stylex.create({
  reading: {
    fontSize: "var(--rte-text-reading-size)",
    lineHeight: "var(--rte-text-reading-leading)",
    fontWeight: 400,
  },
  sentenceWord: {
    fontSize: "var(--rte-text-reading-size)",
    lineHeight: "var(--rte-text-reading-leading)",
  },
  unstressedWord: {
    fontWeight: 400,
  },
  stressedWord: {
    fontWeight: "var(--font-weight-bold)",
  },
  wordAndPunctuation: {
    whiteSpace: "nowrap",
  },
  compactSave: {
    alignSelf: "start",
  },
  spokenWord: {
    backgroundColor: "var(--color-warning-muted)",
  },
  stressDots: {
    fontSize: "0.75em",
    marginInlineStart: "var(--spacing-0-5)",
  },
  tapTarget: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "1.5rem",
  },
});

// Without a word, only the Saved state needs a name beyond the visible label.
function saveLabel(saved: boolean, word: string | undefined): string | undefined {
  if (word === undefined) {
    return saved ? "Saved, remove from review deck" : undefined;
  }
  return saved ? `Saved “${word}”, remove from review deck` : `Save “${word}” to review`;
}

export function SaveToReview({
  card,
  label,
  word,
  saved,
  addCard,
  removeCard,
  undoRemove,
  compact = false,
}: {
  card: NewCard;
  label: string;
  compact?: boolean;
  // Names the word in the accessible name, for a list of word save buttons.
  word?: string;
  saved: boolean;
  addCard: (input: NewCard) => Promise<void>;
  removeCard: (id: string) => Promise<VocabCard>;
  undoRemove: (tombstone: VocabCard) => Promise<boolean>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // Set by a save this visit, so the Saved state is announced; the Undo toast announces a removal.
  const [announced, setAnnounced] = useState(false);
  const isSavingRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const showToast = useToast();

  const undo = async (tombstone: VocabCard, dismiss: () => void, undoButton: HTMLElement) => {
    const toast = undoButton.closest("[data-toast-id]") ?? undoButton;
    dismiss();
    try {
      if (!(await undoRemove(tombstone))) {
        showToast({ body: "Couldn't undo: this card changed since it was removed." });
      }
    } catch {
      showToast({ body: "Couldn't undo. Try again." });
    }
    // The dismissed toast took the focused Undo with it; the toggle it undid is the next target,
    // unless the user moved focus elsewhere during the await.
    const active = document.activeElement;
    if (active === null || active === document.body || toast.contains(active)) {
      buttonRef.current?.focus();
    }
  };

  const toggle = async () => {
    if (isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setFailed(false);
    setAnnounced(false);
    try {
      if (saved) {
        const tombstone = await removeCard(cardId(card.source));
        // The toast stays until dismissed, so there is time to reach Undo.
        const dismiss = showToast({
          body: "Removed from your review deck. Undo restores it.",
          isAutoHide: false,
          endContent: <Button label="Undo" variant="secondary" size="sm" onClick={(event) => void undo(tombstone, dismiss, event.currentTarget)} />,
        });
      } else {
        await addCard(card);
        setAnnounced(true);
      }
    } catch {
      setFailed(true);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <>
      <Button
        ref={buttonRef}
        label={saved ? "Saved" : label}
        aria-label={saveLabel(saved, word)}
        variant="ghost"
        xstyle={compact ? styles.compactSave : undefined}
        isDisabled={isSaving}
        // A tooltip makes Astryx use aria-disabled, so the pressed button keeps keyboard focus.
        tooltip={isSaving ? "Saving…" : saved ? "Remove from your review deck" : undefined}
        onClick={() => void toggle()}
      />
      {failed && <Alert>Couldn't save. Try again.</Alert>}
      <VisuallyHidden>
        <Status>{announced && saved && "Saved to your review deck."}</Status>
      </VisuallyHidden>
    </>
  );
}

// Splits on letter/digit runs (apostrophes kept, so "What's" is one word;
// hyphens inside join a compound, so "T-shirt" is one word) and renders each
// run whose cardWord() is a card word as a button; everything
// else stays plain text, so the sentence text reads exactly as authored. The
// word whose character range holds spokenChar is marked as currently spoken.
// The selected word's button is expanded and controls its word panel, panelId.
// With stressDict, each stressed word is bold with its syllable dots beside it, the sentence ends
// with its intonation arrow, and a visually hidden summary describes the sentence.
export function SentenceWords({
  text,
  selected,
  spokenChar,
  panelId,
  onSelect,
  stressDict,
}: {
  text: string;
  selected: string | null;
  spokenChar: number | null;
  panelId: string;
  onSelect: (text: string) => void;
  stressDict: StressDict | null;
}) {
  const summaryId = useId();
  const parts = splitWords(text);
  const stresses = parts.map((part) =>
    stressDict && isCardWord(cardWord(part)) ? wordStress(part, stressDict) : null,
  );
  const tone = stressDict && intonation(text);
  const stressed = parts.filter((_, index) => stresses[index]);
  const summary = [
    stressed.length > 0 && `Stressed: ${stressed.join(", ")}.`,
    tone && `${tone === "falling" ? "Falling" : "Rising"} intonation.`,
  ]
    .filter(Boolean)
    .join(" ");
  let start = 0;
  const offsets = parts.map((part) => {
    const offset = start;
    start += part.length;
    return offset;
  });
  const punctuationAfter = parts.map((part, index) =>
    isCardWord(cardWord(part)) ? parts[index + 1]?.match(/^[^\s\p{L}\p{N}'’]+/u)?.[0] ?? "" : "",
  );
  return (
    <>
      <p aria-describedby={summary ? summaryId : undefined} {...stylex.props(styles.reading)}>
        {parts.map((part, index) => {
          if (!isCardWord(cardWord(part))) {
            const precedingPunctuation = punctuationAfter[index - 1] ?? "";
            return precedingPunctuation && part.startsWith(precedingPunctuation)
              ? part.slice(precedingPunctuation.length)
              : part;
          }
          const partStart = offsets[index];
          const stress = stresses[index];
          const spoken =
            spokenChar !== null && spokenChar >= partStart && spokenChar < partStart + part.length;
          const expanded = part === selected;
          const button = (
            <Button
              label={part}
              size="sm"
              variant={expanded ? "secondary" : "ghost"}
              aria-expanded={expanded}
              aria-controls={expanded ? panelId : undefined}
              aria-current={spoken ? "true" : undefined}
              style={{ paddingInline: 0 }}
              xstyle={[styles.sentenceWord, spoken && styles.spokenWord]}
              onClick={() => onSelect(part)}
            >
              <span {...stylex.props(stress ? styles.stressedWord : styles.unstressedWord)}>{part}</span>
            </Button>
          );
          const punctuation = punctuationAfter[index];
          return (
            <span key={index} {...stylex.props(styles.wordAndPunctuation)}>
              {button}
              {stress && (
                <span aria-hidden="true" {...stylex.props(styles.stressDots)}>
                  {Array.from({ length: stress.syllables }, (_, syllable) =>
                    syllable === stress.primary ? "●" : "•",
                  ).join(" ")}
                </span>
              )}
              {punctuation}
            </span>
          );
        })}
        {tone && (
          <span role="img" aria-label={`${tone} intonation`}>
            {tone === "falling" ? " ↘" : " ↗"}
          </span>
        )}
      </p>
      {summary && <VisuallyHidden id={summaryId}>{summary}</VisuallyHidden>}
    </>
  );
}

export function WordPanel({
  id,
  text,
  card,
  savedCardIds,
  addCard,
  removeCard,
  undoRemove,
  hear,
}: {
  id: string;
  text: string;
  card: NewCard;
  savedCardIds: Set<string>;
  addCard: (input: NewCard) => Promise<void>;
  removeCard: (id: string) => Promise<VocabCard>;
  undoRemove: (tombstone: VocabCard) => Promise<boolean>;
  hear: () => void;
}) {
  // Lookups keep an inner apostrophe ("don't") but drop quote marks and keep hyphens ("t-shirt"); the card id uses cardWord().
  const word = text.toLowerCase().normalize("NFC").replace(/’/g, "'").replace(/^'+|'+$/g, "");
  // The panel is keyed by word, so a late response for a previous word lands on an unmounted panel.
  const [lookup, setLookup] = useState<"idle" | "pending" | "unreachable" | Definition | null>("idle");

  const define = async () => {
    setLookup("pending");
    try {
      setLookup(await lookupWord(word));
    } catch {
      setLookup("unreachable");
    }
  };

  return (
    <VStack gap={1} id={id}>
      <HStack gap={1} align="center" xstyle={sharedStyles.shadowingControls}>
        <Text weight="semibold">{text}</Text>
        <Button
          label="Hear word"
          variant="secondary"
          isDisabled={!speechSupported()}
          onClick={hear}
        />
        <SaveToReview
          key={card.source.word}
          card={card}
          label="Save word"
          saved={savedCardIds.has(cardId(card.source))}
          addCard={addCard}
          removeCard={removeCard}
          undoRemove={undoRemove}
        />
        <Button
          label="Define"
          variant="secondary"
          isDisabled={lookup === "pending"}
          tooltip={lookup === "pending" ? "Looking up…" : undefined}
          onClick={() => void define()}
        />
        <Link
          href={"https://youglish.com/pronounce/" + encodeURIComponent(word) + "/english"}
          isExternalLink
          xstyle={styles.tapTarget}
        >
          Hear it on YouGlish
        </Link>
      </HStack>
      <Status>
        {lookup === "pending" && <Text as="p" type="supporting">Looking up…</Text>}
        {lookup === null && <Text as="p" type="supporting">No definition</Text>}
        {lookup === "unreachable" && (
          <Text as="p" type="supporting">Couldn't reach the dictionary. Check your connection.</Text>
        )}
        {typeof lookup === "object" && lookup !== null && (
          <Text as="p">
            {lookup.phonetic && `${lookup.phonetic} · `}
            <Text weight="semibold">{lookup.partOfSpeech}</Text> — {lookup.definition}
          </Text>
        )}
      </Status>
    </VStack>
  );
}
