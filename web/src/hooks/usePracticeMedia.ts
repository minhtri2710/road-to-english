import { useYouTubePlayer } from "./useYouTubePlayer";
import { abortActiveRecognition } from "../lib/recognition";
import { speechSupported, stopSpeaking } from "../lib/speech";
import { stopActiveRecording } from "./useRecorder";

// Every mounted recording player, across all sentences, so starting any medium can pause them.
const recordingAudios = new Set<HTMLAudioElement>();

// Registers a mounted recording player; the returned cleanup unregisters and pauses it.
export function registerRecordingAudio(audio: HTMLAudioElement): () => void {
  recordingAudios.add(audio);
  return () => {
    recordingAudios.delete(audio);
    audio.pause();
  };
}

export type StopMedia = (options?: { keepVideo?: boolean; keepAudio?: HTMLAudioElement }) => void;

// One practice medium at a time: starting reference speech, the video, a recording or a
// pronunciation check first stops the others, in every sentence. The video's own play
// stops the rest but not itself, and so does a recording's. onStop clears the view's media state.
export function usePracticeMedia(videoId: string | undefined, onStop: () => void) {
  const stopMedia: StopMedia = ({ keepVideo = false, keepAudio } = {}) => {
    onStop();
    if (speechSupported()) {
      stopSpeaking();
    }
    abortActiveRecognition();
    stopActiveRecording();
    recordingAudios.forEach((audio) => {
      if (audio !== keepAudio) {
        audio.pause();
      }
    });
    if (!keepVideo) {
      video.pauseClip();
    }
  };
  const video = useYouTubePlayer(videoId, () => stopMedia({ keepVideo: true }));
  return { stopMedia, video };
}
