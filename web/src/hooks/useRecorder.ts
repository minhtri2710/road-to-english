import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "recording" | "ready" | "error";

export interface RecorderControls {
  state: RecorderState;
  url: string | null;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function revokeObjectUrl(url: string): void {
  if (typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}

export function useRecorder(): RecorderControls {
  const [state, setState] = useState<RecorderState>("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      revokeObjectUrl(urlRef.current);
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

    let stream: MediaStream | null = null;
    try {
      stream = await getUserMedia.call(navigator.mediaDevices, { audio: true });
      if (!mountedRef.current) {
        stopStream(stream);
        return;
      }

      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
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
            new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }),
          );
          replaceUrl(nextUrl);
          setError(null);
          updateState("ready");
        } catch {
          setError("Unable to prepare the recording for replay.");
          updateState("error");
        }
      };

      recorder.start();
      updateState("recording");
    } catch {
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
        revokeObjectUrl(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  return { state, url, error, startRecording, stopRecording };
}
