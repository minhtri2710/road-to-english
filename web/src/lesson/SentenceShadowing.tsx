import { useEffect, useRef, useState } from "react";

import { Button } from "@astryxdesign/core/Button";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { Status } from "../components/feedback";
import { sharedStyles } from "../components/styles";
import { registerRecordingAudio, type StopMedia } from "../hooks/usePracticeMedia";
import { recordingSupported, useRecorder } from "../hooks/useRecorder";
import { recognizeOnce } from "../lib/recognition";
import { speak, speechSupported, stopSpeaking } from "../lib/speech";
import { WordDiffResult, type PracticeMode } from "./SentenceQuiz";

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
  const recorder = useRecorder();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playBlocked, setPlayBlocked] = useState(false);
  const [speechFailed, setSpeechFailed] = useState(false);
  const recognitionRef = useRef<ReturnType<typeof recognizeOnce> | null>(null);
  const checkButtonRef = useRef<HTMLButtonElement>(null);
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
          label="Listen"
          variant="secondary"
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
          label="Loop"
          isPressed={looping}
          isDisabled={!canSpeak || listening}
          onPressedChange={(pressed) => {
            stopMedia();
            if (pressed) {
              setSpeechFailed(false);
              setLooping(true);
            }
          }}
        />
        <Button
          label={recorder.state === "recording" ? "Stop" : "Record"}
          variant="secondary"
          isDisabled={!canRecord || recorder.state === "requesting"}
          isLoading={recorder.state === "requesting"}
          // A tooltip makes Astryx use aria-disabled, so the pressed button keeps keyboard focus.
          tooltip={recorder.state === "requesting" ? "Starting the microphone…" : undefined}
          onClick={() => {
            if (recorder.state === "recording") {
              recorder.stopRecording();
            } else {
              stopMedia();
              void recorder.startRecording();
            }
          }}
        />
        <Button
          label="Compare"
          variant="secondary"
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
            label={listening ? "Listening…" : "Check pronunciation"}
            variant="secondary"
            isDisabled={listening}
            tooltip={listening ? "Say the sentence" : undefined}
            onClick={checkPronunciation}
          />
        )}
      </HStack>
      {!canSpeak && (
        <Text as="p" type="supporting">
          Listen disabled: speech synthesis is not supported in this browser.
        </Text>
      )}
      {!canRecord && (
        <Text as="p" type="supporting">
          Recording disabled: microphone recording is not supported in this browser.
        </Text>
      )}
      {recorder.url && (
        <audio
          ref={audioRef}
          controls
          src={recorder.url}
          onPlay={(event) => stopMedia({ keepAudio: event.currentTarget })}
        />
      )}
      <Status>
        {speechFailed && (
          <Text as="p" type="supporting">
            Couldn't play the sentence. Check your browser's speech settings.
          </Text>
        )}
        {recorder.error && (
          <Text as="p" color="primary" xstyle={sharedStyles.error}>
            {recorder.error}
          </Text>
        )}
        {playBlocked && (
          <Text as="p" type="supporting">
            Press play to hear your recording.
          </Text>
        )}
        {check.status === "heard" && (
          <WordDiffResult text={text} answer={check.transcript} verb="said" />
        )}
        {check.status === "failed" && (
          <Text as="p" color="primary" xstyle={sharedStyles.error}>
            {check.message}
          </Text>
        )}
      </Status>
      {(check.status === "heard" || check.status === "failed") && (
        <Button label="Try again" variant="ghost" onClick={tryAgain} />
      )}
    </VStack>
  );
}
