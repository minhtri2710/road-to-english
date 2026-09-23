// ponytail: 180 WPM is a heuristic rate-one mapping; speech engines vary, so tune this constant if calibration changes.
export const WPM_AT_RATE_ONE = 180;

let current: SpeechSynthesisUtterance | null = null;

// onEnd runs only if this utterance is still current, so a cancelled or superseded
// utterance's late onend never triggers follow-up speech.
export function speak(
  text: string,
  targetWpm: number,
  speed: number,
  onEnd?: () => void,
): SpeechSynthesisUtterance {
  current = null;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = Math.min(2, Math.max(0.5, targetWpm / WPM_AT_RATE_ONE)) * speed;
  utterance.onend = () => {
    if (current !== utterance) {
      return;
    }
    current = null;
    onEnd?.();
  };
  current = utterance;
  window.speechSynthesis.speak(utterance);
  return utterance;
}

// Without an argument, stops any speech; with one, stops only if that utterance is still current.
export function stopSpeaking(utterance?: SpeechSynthesisUtterance | null): void {
  if (utterance !== undefined && utterance !== current) {
    return;
  }
  current = null;
  window.speechSynthesis.cancel();
}
