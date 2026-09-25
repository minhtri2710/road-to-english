import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import { describe, expect, it } from "vitest";

import { buildStressDict, verifySha256 } from "./build-stress-dict.mjs";

const FIXTURE = `a AH0
a(2) EY1
aalborg AO1 L B AO0 R G # place, danish
DON'T D OW1 N T
record R AH0 K AO1 R D
record(2) R EH1 K ER0 D
record(3) R IH0 K AO1 R D
`;

describe("build-stress-dict", () => {
  it("strips comments, merges variants, drops duplicate patterns and sorts the words", () => {
    expect(buildStressDict(FIXTURE)).toBe('{"a":"0,1","aalborg":"10","don\'t":"1","record":"01,10"}\n');
  });

  it("accepts the recorded sha256 and rejects any other", () => {
    const sha = createHash("sha256").update(FIXTURE).digest("hex");
    expect(() => verifySha256(Buffer.from(FIXTURE), sha)).not.toThrow();
    expect(() => verifySha256(Buffer.from(FIXTURE))).toThrow(/sha256 is .*, expected 81917843/);
  });

  it.each([
    ["the script path", (script) => script],
    [
      "a symlink to the script",
      (script, dir) => {
        const link = join(dir, "build-stress-dict.mjs");
        symlinkSync(script, link);
        return link;
      },
    ],
  ])("exits non-zero on a dictionary that is not the pinned one, leaving the output alone, run through %s", (_, invoke) => {
    const output = join(import.meta.dirname, "../src/lib/stressDict.json");
    const before = readFileSync(output);
    const dir = mkdtempSync(join(tmpdir(), "stress-dict-"));
    try {
      const input = join(dir, "cmudict.dict");
      writeFileSync(input, FIXTURE);
      const script = join(import.meta.dirname, "build-stress-dict.mjs");
      expect(() => execFileSync(execPath, [invoke(script, dir), input], { stdio: "pipe" })).toThrow(/sha256/);
    } finally {
      rmSync(dir, { recursive: true });
    }
    expect(readFileSync(output).equals(before)).toBe(true);
  });
});
