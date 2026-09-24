import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach } from "vitest";

import { WELCOMED_KEY, WELCOMED_VALUE } from "../hooks/useWelcome";

beforeEach(() => {
  indexedDB = new IDBFactory();
  // Tests start past the first-run welcome; welcome tests remove this key to opt in.
  localStorage.setItem(WELCOMED_KEY, WELCOMED_VALUE);
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
