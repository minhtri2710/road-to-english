let syncTrigger: (() => void) | undefined;

export function setSyncTrigger(trigger: (() => void) | undefined): void {
  syncTrigger = trigger;
}

export function notifyLocalMutation(): void {
  syncTrigger?.();
}
