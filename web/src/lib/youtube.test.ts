import { describe, expect, it } from "vitest";

import { parseTranscript, parseYouTubeId } from "./youtube";

const ID = "dQw4w9WgXcQ";

describe("parseYouTubeId", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=${ID}&t=42s&list=PL1`,
    `https://www.youtube.com/watch?feature=share&v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `  https://m.youtube.com/embed/${ID}  `,
  ])("accepts %s", (url) => {
    expect(parseYouTubeId(url)).toBe(ID);
  });

  it.each([
    ["a wrong host", `https://www.youtube.evil.com/watch?v=${ID}`],
    ["a lookalike host", `https://notyoutube.com/watch?v=${ID}`],
    ["a youtu.be subdomain", `https://www.youtu.be/${ID}`],
    ["a short id", "https://youtu.be/dQw4w9WgXc"],
    ["a long id", `https://www.youtube.com/watch?v=${ID}x`],
    ["a bad id character", "https://youtu.be/dQw4w9WgX.Q"],
    ["a javascript: URL", `javascript:alert("${ID}")`],
    ["a data: URL", `data:text/html,https://youtu.be/${ID}`],
    ["missing v", "https://www.youtube.com/watch?list=PL1"],
    ["an http URL", `http://www.youtube.com/watch?v=${ID}`],
    ["another path", `https://www.youtube.com/channel/${ID}`],
    ["an extra path segment", `https://youtu.be/${ID}/x`],
    ["a port", `https://youtu.be:8443/${ID}`],
    ["not a URL", ID],
    ["empty", ""],
  ])("rejects %s", (_name, url) => {
    expect(parseYouTubeId(url)).toBeNull();
  });
});

describe("parseTranscript", () => {
  it("parses m:ss, mm:ss and h:mm:ss with multi-line text", () => {
    expect(parseTranscript("0:05\nHello there.\n  How are you?  \n\n12:30\nFine.\n1:02:03\nBye.")).toEqual([
      { text: "Hello there. How are you?", cue: { start: 5, end: 750 } },
      { text: "Fine.", cue: { start: 750, end: 3723 } },
      { text: "Bye.", cue: { start: 3723, end: null } },
    ]);
  });

  it("accepts CRLF input and indented timestamps", () => {
    expect(parseTranscript("0:00\r\nOne.\r\n  0:04  \r\nTwo.\r\n")).toEqual([
      { text: "One.", cue: { start: 0, end: 4 } },
      { text: "Two.", cue: { start: 4, end: null } },
    ]);
  });

  it("drops a cue with no text and ends the previous cue at the next kept start", () => {
    expect(parseTranscript("0:00\nOne.\n0:03\n\n0:07\nTwo.\n0:09")).toEqual([
      { text: "One.", cue: { start: 0, end: 7 } },
      { text: "Two.", cue: { start: 7, end: null } },
    ]);
  });

  it("ends every cue at the next start and the last at null", () => {
    const cues = parseTranscript("0:01\na\n0:02\nb\n0:03\nc").map(({ cue }) => cue);
    expect(cues.slice(0, -1).map(({ end }, i) => end === cues[i + 1]?.start)).toEqual([true, true]);
    expect(cues.at(-1)?.end).toBeNull();
  });

  it("rejects text before the first timestamp", () => {
    expect(() => parseTranscript("Intro\n0:00\nOne.")).toThrow("The transcript must start with a timestamp.");
  });

  it.each([
    ["equal", "0:05\nOne.\n0:05\nTwo."],
    ["decreasing", "1:00\nOne.\n0:59\nTwo."],
  ])("rejects %s timestamps", (_name, text) => {
    expect(() => parseTranscript(text)).toThrow("Timestamps must increase");
  });

  it.each(["1:75", "1:60:00", "0:60"])("rejects the out-of-range timestamp %s", (stamp) => {
    expect(() => parseTranscript(`0:00\nOne.\n${stamp}\nTwo.`)).toThrow(`Invalid timestamp: ${stamp}.`);
  });

  it.each(["60:00", "75:30"])("rejects %s minutes past 59 with the h:mm:ss hint", (stamp) => {
    expect(() => parseTranscript(`0:00\nOne.\n${stamp}\nTwo.`)).toThrow(
      `Invalid timestamp: ${stamp}. Use h:mm:ss past an hour.`,
    );
  });

  it("accepts 59:59 and unbounded h:mm:ss hours", () => {
    expect(
      parseTranscript("0:00\nOne.\n59:59\nTwo.\n1:00:00\nThree.\n10:00:00\nFour.").map(({ cue }) => cue.start),
    ).toEqual([0, 3599, 3600, 36000]);
  });

  it("accepts the largest in-range fields", () => {
    expect(parseTranscript("0:00\nOne.\n59:59\nTwo.\n1:59:59\nThree.").map(({ cue }) => cue.start)).toEqual([
      0, 3599, 7199,
    ]);
  });

  it("treats non-timestamp lines as text", () => {
    expect(parseTranscript("0:00\n1:2\n123:45\n1:234")).toEqual([
      { text: "1:2 123:45 1:234", cue: { start: 0, end: null } },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(parseTranscript(" \n\r\n")).toEqual([]);
  });
});
