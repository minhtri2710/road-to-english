import { afterEach, describe, expect, it } from "vitest";

import { getLang, LANG_KEY, setLang, tr } from "./index";
import { vi } from "./vi";

describe("i18n", () => {
  afterEach(() => setLang("en"));

  it("keeps English as written and fills template holes", () => {
    expect(tr("Sentence {n} of {count}", { n: 2, count: 9 })).toBe("Sentence 2 of 9");
    expect(tr("No such entry")).toBe("No such entry");
  });

  it("switches to Vietnamese, remembers it and sets the document language", () => {
    setLang("vi");
    expect(getLang()).toBe("vi");
    expect(localStorage.getItem(LANG_KEY)).toBe("vi");
    expect(document.documentElement.lang).toBe("vi");
    expect(tr("Library")).toBe(vi["Library"]);
    expect(tr("No such entry")).toBe("No such entry");
    setLang("en");
    expect(localStorage.getItem(LANG_KEY)).toBeNull();
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps every Vietnamese template's holes", () => {
    for (const [english, vietnamese] of Object.entries(vi)) {
      const holes = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(holes(vietnamese), english).toEqual(holes(english));
    }
  });
});
