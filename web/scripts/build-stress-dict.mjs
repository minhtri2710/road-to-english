// Builds web/src/lib/stressDict.json from a local copy of CMUdict's cmudict.dict:
//   node web/scripts/build-stress-dict.mjs <path-to-cmudict.dict>
// Source: https://github.com/cmusphinx/cmudict at commit 74790861f652b15e4ac49015a90074ad62a27690,
// https://raw.githubusercontent.com/cmusphinx/cmudict/74790861f652b15e4ac49015a90074ad62a27690/cmudict.dict
// (BSD-2-Clause, see NOTICE). The input must match that file's sha256, or the script exits non-zero.
//
// Encoding: one JSON object, keys sorted, mapping each lowercase word (CMUdict's apostrophes kept)
// to its distinct stress patterns joined by ",". A pattern is the stress digits of the word's vowels
// in order (0 none, 1 primary, 2 secondary): "banana" -> "010", "record" -> "01,10". The "(n)"
// variants merge into their word and duplicate patterns are dropped, in dictionary order.
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, stderr } from "node:process";
import { pathToFileURL } from "node:url";

export const CMUDICT_SHA256 = "81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22";
const OUTPUT = join(import.meta.dirname, "../src/lib/stressDict.json");

export function verifySha256(source, expected = CMUDICT_SHA256) {
  const actual = createHash("sha256").update(source).digest("hex");
  if (actual !== expected) {
    throw new Error(`cmudict.dict sha256 is ${actual}, expected ${expected}`);
  }
}

// The dictionary's JSON text for cmudict.dict's contents.
export function buildStressDict(text) {
  const patterns = new Map();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (line === "") continue;
    const [entry, ...phones] = line.split(/\s+/);
    const word = entry.replace(/\(\d+\)$/, "").toLowerCase();
    const pattern = phones.map((phone) => phone.match(/[012]$/)?.[0] ?? "").join("");
    const known = patterns.get(word) ?? [];
    if (!known.includes(pattern)) known.push(pattern);
    patterns.set(word, known);
  }
  const entries = [...patterns.keys()].sort().map((word) => [word, patterns.get(word).join(",")]);
  return "{" + entries.map(([word, value]) => `${JSON.stringify(word)}:${JSON.stringify(value)}`).join(",") + "}\n";
}

if (argv[1] && import.meta.url === pathToFileURL(realpathSync(argv[1])).href) {
  if (argv.length !== 3) {
    stderr.write("usage: node web/scripts/build-stress-dict.mjs <path-to-cmudict.dict>\n");
    exit(2);
  }
  const source = readFileSync(argv[2]);
  try {
    verifySha256(source);
  } catch (error) {
    stderr.write(`${error.message}\n`);
    exit(1);
  }
  writeFileSync(OUTPUT, buildStressDict(source.toString("utf8")));
}
