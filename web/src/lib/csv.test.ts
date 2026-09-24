import { describe, expect, it } from "vitest";

import { cardsCsv, cardsCsvFileName } from "./csv";
import { deleteCard } from "./vocab";
import { card } from "../test/fixtures";

const due = new Date("2026-09-23T10:20:30.000Z");

describe("cardsCsv", () => {
  it("quotes every field and keeps special characters verbatim", () => {
    const cards = [
      card("s5", due, { front: "vi", back: "Xin chào, thế giới" }),
      card("s4", due, { front: "crlf", back: "a\r\nb" }),
      card("s3", due, { front: "lf", back: "a\nb" }),
      card("s2", due, { front: 'say "hi"', back: "quote" }),
      card("s1", due, { front: "a, b", back: "comma" }),
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
    const cards = ["=1", "+1", "-1", "@a", "\tx", "\ry"].map((front, i) => card(`s${i}`, due, { front, back: "a=b" }));
    expect(cardsCsv(cards)).toBe(
      '\uFEFF"front","back","due"\r\n' +
        ["'=1", "'+1", "'-1", "'@a", "'\tx", "'\ry"].map((front) => `"${front}","a=b","${iso}"\r\n`).join(""),
    );
  });

  it("writes the due ISO string", () => {
    expect(cardsCsv([card("s1", due, { front: "x", back: "y" })])).toContain('"2026-09-23T10:20:30.000Z"');
  });

  it("leaves out deleted cards", () => {
    expect(cardsCsv([card("s1", due, { front: "kept", back: "a" }), deleteCard(card("s2", due, { front: "gone", back: "b" }), due)])).toBe(
      '\uFEFF"front","back","due"\r\n"kept","a","' + due.toISOString() + '"\r\n',
    );
  });

  it("returns the BOM and header for no cards", () => {
    expect(cardsCsv([])).toBe('﻿"front","back","due"\r\n');
  });

  it("names the file by local date", () => {
    expect(cardsCsvFileName(new Date(2026, 8, 23, 12))).toBe("road-to-english-cards-2026-09-23.csv");
  });
});
