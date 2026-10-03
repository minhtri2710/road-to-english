import { useEffect, useRef, useState } from "react";

import { Button } from "@astryxdesign/core/Button";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";

import * as stylex from "@stylexjs/stylex";

import { Status } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import { registerRecordingAudio, type StopMedia } from "../hooks/usePracticeMedia";
import { recordingSupported, useRecorder } from "../hooks/useRecorder";
import { RecordingWaveform } from "./RecordingWaveform";
import type { PracticeMode } from "../lib/progress";
import { recognizeOnce } from "../lib/recognition";
import { speak, speechSupported, stopSpeaking } from "../lib/speech";
import { WordDiffResult } from "./SentenceQuiz";
import { useT } from "../i18n";

// Reference speech highlights the spoken word of its sentence. Any start, end or
// error clears the highlight; speak's current-utterance guard drops superseded events.
function playReference(
  text: string,
  targetWpm: number,
  speed: number,
  sentenceId: string,
  setSpokenWord: (spoken: { sentenceId: string; charIndex: number } | null) => void,
  handlers: { onEnd?: () => void; onError?: () => void } = {},
): SpeechSynthesisUtterance {
  setSpokenWord(null);
  return speak(text, targetWpm, speed, {
    onWord: (charIndex) => setSpokenWord({ sentenceId, charIndex }),
    onEnd: () => {
      setSpokenWord(null);
      handlers.onEnd?.();
    },
    onError: () => {
      setSpokenWord(null);
      handlers.onError?.();
    },
  });
}

// A clip shorter than this (a Record cut off by another medium) earns no recording XP.
const MIN_RECORDING_MS = 1000;

const recordingAnimation = stylex.keyframes({
  "0%, 100%": { boxShadow: "0 0 0 0 color-mix(in srgb, var(--rte-color-speak) 42%, transparent)" },
  "50%": { boxShadow: "0 0 0 5px transparent" },
});

const styles = stylex.create({
  recordingControl: {
    position: "relative",
    display: "inline-block",
  },
  recordingLabel: {
    display: "inline-grid",
  },
  recordingLabelText: {
    gridArea: "1 / 1",
  },
  recordingLabelHidden: {
    visibility: "hidden",
  },
  recordingButton: {
    backgroundColor: "var(--rte-color-speak-muted)",
    outline: "2px solid var(--rte-color-speak)",
    outlineOffset: 2,
    animationName: recordingAnimation,
    animationDuration: "var(--duration-slow)",
    animationTimingFunction: "var(--ease-standard)",
    animationIterationCount: "infinite",
  },
  meterTrack: {
    position: "absolute",
    insetInline: "var(--spacing-1)",
    bottom: "2px",
    zIndex: 1,
    height: "3px",
    overflow: "hidden",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--color-background-muted)",
  },
  meterFill: {
    display: "block",
    width: "100%",
    height: "100%",
    borderRadius: "inherit",
    backgroundColor: "var(--color-success)",
    transform: "scaleX(var(--input-level, 0))",
    transformOrigin: "left center",
  },
});

export function SentenceShadowing({
  text,
  targetWpm,
  speed,
  looping,
  setLooping,
  sentenceId,
  setSpokenWord,
  practice,
  pronunciationCheck,
  stopMedia,
}: {
  text: string;
  targetWpm: number;
  speed: number;
  looping: boolean;
  setLooping: (looping: boolean) => void;
  sentenceId: string;
  setSpokenWord: (spoken: { sentenceId: string; charIndex: number } | null) => void;
  practice: (mode: PracticeMode) => void;
  pronunciationCheck: boolean;
  stopMedia: StopMedia;
}) {
  const t = useT();
  const recorder = useRecorder();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playBlocked, setPlayBlocked] = useState(false);
  const [speechFailed, setSpeechFailed] = useState(false);
  const recognitionRef = useRef<ReturnType<typeof recognizeOnce> | null>(null);
  const checkButtonRef = useRef<HTMLButtonElement>(null);
  const [checkId, setCheckId] = useState(0);
  const [check, setCheck] = useState<
    | { status: "idle" }
    | { status: "listening" }
    | { status: "heard"; transcript: string }
    | { status: "failed"; message: string }
  >({ status: "idle" });
  const canSpeak = speechSupported();
  const listening = check.status === "listening";
  const canRecord = recordingSupported();

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    return registerRecordingAudio(audio);
  }, [recorder.url]);

  useEffect(() => {
    if (recorder.state === "ready" && (recorder.durationMs ?? 0) >= MIN_RECORDING_MS) {
      practice("recording");
    }
  }, [practice, recorder.state, recorder.durationMs]);

  useEffect(() => {
    if (!looping) {
      return;
    }
    let latest: SpeechSynthesisUtterance | null = null;
    const repeat = () => {
      latest = playReference(text, targetWpm, speed, sentenceId, setSpokenWord, {
        onEnd: repeat,
        onError: () => {
          setLooping(false);
          setSpeechFailed(true);
        },
      });
    };
    repeat();
    return () => {
      stopSpeaking(latest);
      setSpokenWord(null);
    };
  }, [looping, speed, targetWpm, text, sentenceId, setSpokenWord]);

  useEffect(() => {
    if (!pronunciationCheck) {
      return;
    }
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      setCheck({ status: "idle" });
    };
  }, [pronunciationCheck]);

  const checkPronunciation = () => {
    setCheckId((current) => current + 1);
    stopMedia();
    setCheck({ status: "listening" });
    const recognition = recognizeOnce();
    recognitionRef.current = recognition;
    recognition.result.then(
      (transcript) => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setCheck({ status: "heard", transcript });
        if (transcript.trim()) {
          practice("check");
        }
      },
      (error: Error) => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setCheck(
          error.name === "AbortError"
            ? { status: "idle" }
            : { status: "failed", message: error.message },
        );
      },
    );
  };

  // Try again removes itself, so focus goes back to the check it repeats.
  const tryAgain = () => {
    setCheck({ status: "idle" });
    checkButtonRef.current?.focus();
  };

  return (
    <VStack gap={1}>
      <HStack gap={1} xstyle={sharedStyles.shadowingControls}>
        <Button
          label={t("Listen")}
          variant="primary"
          data-shortcut="listen"
          isDisabled={!canSpeak || listening}
          onClick={() => {
            stopMedia();
            setSpeechFailed(false);
            playReference(text, targetWpm, speed, sentenceId, setSpokenWord, {
              onError: () => setSpeechFailed(true),
            });
          }}
        />
        <ToggleButton
          label={t("Loop")}
          isPressed={looping}
          isDisabled={!canSpeak || listening}
          onClick={() => {
            stopMedia();
            if (!looping) {
              setSpeechFailed(false);
              setLooping(true);
            } else {
              setLooping(false);
            }
          }}
        />
        <div data-testid="recording-control" className={stylex.props(styles.recordingControl).className}>
          <Button
            label={recorder.state === "recording" ? t("Stop") : t("Record")}
            data-shortcut="record"
            xstyle={recorder.state === "recording" ? styles.recordingButton : undefined}
            variant="secondary"
            children={(
              <span className={stylex.props(styles.recordingLabel).className}>
                <span className={stylex.props(styles.recordingLabelText).className}>{recorder.state === "recording" ? t("Stop") : t("Record")}</span>
                <span aria-hidden="true" className={stylex.props(styles.recordingLabelText, styles.recordingLabelHidden).className}>{t("Record")}</span>
              </span>
            )}
            isDisabled={!canRecord || recorder.state === "requesting"}
            isLoading={recorder.state === "requesting"}
            // A tooltip makes Astryx use aria-disabled, so the pressed button keeps keyboard focus.
            tooltip={recorder.state === "requesting" ? t("Starting the microphone…") : undefined}
            onClick={() => {
              if (recorder.state === "recording") {
                recorder.stopRecording();
              } else {
                stopMedia();
                void recorder.startRecording();
              }
            }}
          />
          {recorder.state === "recording" && recorder.meterAvailable && (
            <span aria-hidden="true" data-testid="recording-level-meter" className={stylex.props(styles.meterTrack).className}>
              <span data-testid="recording-level-fill" ref={recorder.meterRef} className={stylex.props(styles.meterFill).className} />
            </span>
          )}
        </div>
        <Button
          label={t("Compare")}
          variant="ghost"
          isDisabled={!canSpeak || listening || !recorder.url}
          onClick={() => {
            stopMedia();
            setPlayBlocked(false);
            // A reference that fails to speak still leads to the recording.
            const playRecording = () => {
              audioRef.current?.play().catch(() => setPlayBlocked(true));
            };
            playReference(text, targetWpm, speed, sentenceId, setSpokenWord, {
              onEnd: playRecording,
              onError: playRecording,
            });
          }}
        />
        {pronunciationCheck && (
          <Button
            ref={checkButtonRef}
            label={listening ? t("Listening…") : t("Check pronunciation")}
            variant="ghost"
            isDisabled={listening}
            tooltip={listening ? t("Say the sentence") : undefined}
            onClick={checkPronunciation}
          />
        )}
      </HStack>
      {!canSpeak && (
        <Text as="p" type="supporting">
          {t("Listen disabled: speech synthesis is not supported in this browser.")}
        </Text>
      )}
      {!canRecord && (
        <Text as="p" type="supporting">
          {t("Recording disabled: microphone recording is not supported in this browser.")}
        </Text>
      )}
      {recorder.url && <RecordingWaveform url={recorder.url} text={text} targetWpm={targetWpm} />}
      {recorder.url && (
        <audio
          ref={audioRef}
          aria-label={t("Your recording")}
          controls
          src={recorder.url}
          onPlay={(event) => stopMedia({ keepAudio: event.currentTarget })}
        />
      )}
      {/* Record becomes Stop and back; its own region, as a status region re-reads all of its text on any change. */}
      <VisuallyHidden>
        <Status>
          {recorder.state === "recording" && t("Recording.")}
          {recorder.state === "ready" && t("Recording stopped.")}
        </Status>
      </VisuallyHidden>
      <Status>
        {speechFailed && (
          <Text as="p" type="supporting">
            {t("Couldn't play the sentence. Check your browser's speech settings.")}
          </Text>
        )}
        {recorder.error && (
          <Text as="p" color="primary" xstyle={sharedStyles.error}>
            {recorder.error}
          </Text>
        )}
        {playBlocked && (
          <Text as="p" type="supporting">
            {t("Press play to hear your recording.")}
          </Text>
        )}
        {check.status === "heard" && (
          <WordDiffResult
            text={text}
            answer={check.transcript}
            verb="said"
            checkId={checkId}
            targetWpm={targetWpm}
            speed={speed}
            stopMedia={stopMedia}
          />
        )}
        {check.status === "failed" && (
          <Text as="p" color="primary" xstyle={sharedStyles.error}>
            {check.message}
          </Text>
        )}
      </Status>
      {(check.status === "heard" || check.status === "failed") && (
        <Button label={t("Try again")} variant="ghost" onClick={tryAgain} />
      )}
    </VStack>
  );
}
