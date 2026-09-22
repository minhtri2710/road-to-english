// ponytail: 180 WPM is a heuristic rate-one mapping; speech engines vary, so tune this constant if calibration changes.
export const WPM_AT_RATE_ONE = 180;

export function speak(text: string, targetWpm: number): void {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = Math.min(2, Math.max(0.5, targetWpm / WPM_AT_RATE_ONE));
  window.speechSynthesis.speak(utterance);
}
