import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach } from "vitest";

beforeEach(() => {
  indexedDB = new IDBFactory();
  // Tests start past the first-run welcome; welcome tests remove this key to opt in.
  localStorage.setItem("road-to-english.welcomed", "done");
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
