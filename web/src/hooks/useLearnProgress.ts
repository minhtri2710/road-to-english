import { useCallback, useEffect, useRef, useState } from "react";

import {
  applyLearnChange,
  onLearnProgressChanged,
  readLearnProgress,
  type LearnChange,
  type LearnProgress,
} from "../lib/learnProgress";

// One lesson's committed Learn progress for the view: the stored row or null until it loads, whether the read
// failed, whether a save is in flight, and the change whose save last failed, for Retry save.
export function useLearnProgress(lessonId: string): {
  progress: LearnProgress | null;
  loadFailed: boolean;
  saving: boolean;
  failed: LearnChange | null;
  reload: () => Promise<LearnProgress | null>;
  commit: (change: LearnChange) => Promise<boolean>;
} {
  const [progress, setProgress] = useState<LearnProgress | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<LearnChange | null>(null);
  const active = useRef(false);
  const reads = useRef(0);
  const busy = useRef(false);

  // Resolves to the freshest stored row when this read is still the latest; null when it lost the race,
  // the store read failed, or the view went away.
  const reload = useCallback(async (): Promise<LearnProgress | null> => {
    const seq = ++reads.current;
    try {
      const stored = await readLearnProgress(lessonId);
      if (active.current && reads.current === seq) {
        setProgress(stored);
        setLoadFailed(false);
      }
      return active.current && reads.current === seq ? stored : null;
    } catch {
      if (active.current && reads.current === seq) {
        setProgress(null);
        setLoadFailed(true);
      }
      return null;
    }
  }, [lessonId]);

  useEffect(() => {
    active.current = true;
    const stop = onLearnProgressChanged(reload);
    void reload();
    return () => {
      active.current = false;
      reads.current += 1;
      stop();
    };
  }, [reload]);

  const commit = useCallback(
    async (change: LearnChange): Promise<boolean> => {
      if (!active.current || busy.current || !progress) return false;
      busy.current = true;
      setSaving(true);
      setFailed(null);
      const seq = ++reads.current;
      try {
        const committed = await applyLearnChange(lessonId, change);
        if (!active.current) return false;
        let current: LearnProgress | null = committed;
        if (seq === reads.current) {
          setProgress(committed);
          setLoadFailed(false);
        } else {
          // A sync or import landed during the save; only the canonical row decides the outcome.
          current = await reload();
        }
        return (
          active.current &&
          current !== null &&
          (change.kind === "reset"
            ? current.passed.length === 0 && current.skipsUsed === 0
            : current.passed.includes(change.sentenceId))
        );
      } catch {
        if (active.current) setFailed(change);
        return false;
      } finally {
        busy.current = false;
        if (active.current) setSaving(false);
      }
    },
    [lessonId, progress, reload],
  );

  return { progress, loadFailed, saving, failed, reload, commit };
}
