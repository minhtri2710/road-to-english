import { describe, expect, it } from "vitest";

import { cardsCsv, cardsCsvFileName } from "./csv";
import { createCard } from "./vocab";

const due = new Date("2026-09-23T10:20:30.000Z");
const card = (front: string, back: string, sentenceId: string) =>
  createCard({ front, back, source: { lessonId: "l", sentenceId, word: "" } }, due);

describe("cardsCsv", () => {
  it("quotes every field and keeps special characters verbatim", () => {
    const cards = [
      card("vi", "Xin chào, thế giới", "s5"),
      card("crlf", "a\r\nb", "s4"),
      card("lf", "a\nb", "s3"),
      card('say "hi"', "quote", "s2"),
      card("a, b", "comma", "s1"),
    ];
    const iso = due.toISOString();
    expect(cardsCsv(cards)).toBe(
      "﻿" +
        '"front","back","due"\r\n' +
        `"a, b","comma","${iso}"\r\n` +
        `"say ""hi""","quote","${iso}"\r\n` +
        `"lf","a\nb","${iso}"\r\n` +
        `"crlf","a\r\nb","${iso}"\r\n` +
        `"vi","Xin chào, thế giới","${iso}"\r\n`,
    );
  });

  it("prefixes formula-leading cells with a single quote", () => {
    const iso = due.toISOString();
    const cards = ["=1", "+1", "-1", "@a", "\tx", "\ry"].map((front, i) => card(front, "a=b", `s${i}`));
    expect(cardsCsv(cards)).toBe(
      '\uFEFF"front","back","due"\r\n' +
        ["'=1", "'+1", "'-1", "'@a", "'\tx", "'\ry"].map((front) => `"${front}","a=b","${iso}"\r\n`).join(""),
    );
  });

  it("writes the due ISO string", () => {
    expect(cardsCsv([card("x", "y", "s1")])).toContain('"2026-09-23T10:20:30.000Z"');
  });

  it("returns the BOM and header for no cards", () => {
    expect(cardsCsv([])).toBe('﻿"front","back","due"\r\n');
  });

  it("names the file by local date", () => {
    expect(cardsCsvFileName(new Date(2026, 8, 23, 12))).toBe("road-to-english-cards-2026-09-23.csv");
  });
});
