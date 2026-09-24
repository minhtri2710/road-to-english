import { useCallback, useEffect, useRef, useState } from "react";

type RecorderState = "idle" | "requesting" | "recording" | "ready" | "error";

interface RecorderControls {
  state: RecorderState;
  url: string | null;
  // Milliseconds from start to stop of the latest clip; null before the first one.
  durationMs: number | null;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

// The one recording in progress (or awaiting microphone permission) across all recorders.
let activeStop: (() => void) | null = null;

export function stopActiveRecording(): void {
  activeStop?.();
}

export function useRecorder(): RecorderControls {
  const [state, setState] = useState<RecorderState>("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const stateRef = useRef<RecorderState>("idle");
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const urlRef = useRef<string | null>(null);

  const updateState = (nextState: RecorderState) => {
    stateRef.current = nextState;
    if (mountedRef.current) {
      setState(nextState);
    }
  };

  const replaceUrl = (nextUrl: string) => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
    }
    urlRef.current = nextUrl;
    if (mountedRef.current) {
      setUrl(nextUrl);
    }
  };

  const startRecording = useCallback(async () => {
    if (
      stateRef.current === "requesting" ||
      stateRef.current === "recording"
    ) {
      return;
    }

    const getUserMedia = navigator.mediaDevices?.getUserMedia;
    if (typeof MediaRecorder === "undefined" || !getUserMedia) {
      setError("Microphone recording is not supported in this browser.");
      updateState("error");
      return;
    }

    setError(null);
    updateState("requesting");

    let cancelled = false;
    let recorder: MediaRecorder | null = null;
    const stop = () => {
      cancelled = true;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
    };
    activeStop = stop;
    const release = () => {
      if (activeStop === stop) {
        activeStop = null;
      }
    };

    let stream: MediaStream | null = null;
    try {
      stream = await getUserMedia.call(navigator.mediaDevices, { audio: true });
      if (!mountedRef.current || cancelled) {
        stopStream(stream);
        release();
        updateState("idle");
        return;
      }

      recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      let startedAt = 0;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        release();
        if (streamRef.current === stream) {
          streamRef.current = null;
          stopStream(stream);
        }
        if (recorderRef.current === recorder) {
          recorderRef.current = null;
        }

        if (!mountedRef.current) {
          return;
        }

        try {
          const nextUrl = URL.createObjectURL(
            new Blob(chunksRef.current, { type: recorder?.mimeType || "audio/webm" }),
          );
          replaceUrl(nextUrl);
          setDurationMs(Date.now() - startedAt);
          setError(null);
          updateState("ready");
        } catch {
          setError("Unable to prepare the recording for replay.");
          updateState("error");
        }
      };

      recorder.start();
      startedAt = Date.now();
      updateState("recording");
    } catch {
      release();
      stopStream(stream ?? streamRef.current);
      streamRef.current = null;
      recorderRef.current = null;
      setError("Unable to access the microphone. Please allow microphone access to record.");
      updateState("error");
    }
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      const recorder = recorderRef.current;
      const stream = streamRef.current;
      streamRef.current = null;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // The stream is still released below if stopping the recorder fails.
        }
      }
      stopStream(stream);
      recorderRef.current = null;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  return { state, url, durationMs, error, startRecording, stopRecording };
}
