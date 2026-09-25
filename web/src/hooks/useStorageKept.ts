import { useEffect, useRef, useState } from "react";

export function useStorageKept() {
  const [storageKept, setStorageKept] = useState<boolean | null>(null);
  const persistRequested = useRef(false);

  // Ask once per app start; StrictMode's second effect run keeps the ref and skips.
  useEffect(() => {
    if (persistRequested.current) {
      return;
    }
    persistRequested.current = true;
    if (typeof navigator.storage?.persist !== "function") {
      setStorageKept(false);
      return;
    }
    navigator.storage.persist().then(setStorageKept, () => setStorageKept(false));
  }, []);

  return storageKept;
}
