// Builds web/src/lib/stressDict.json from a local copy of CMUdict's cmudict.dict:
//   node web/scripts/build-stress-dict.mjs <path-to-cmudict.dict>
// The input must match the sha256 pinned in stress-dict.mjs, or the script exits non-zero.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, stderr } from "node:process";

import { buildStressDict, verifySha256 } from "./stress-dict.mjs";

const OUTPUT = join(import.meta.dirname, "../src/lib/stressDict.json");

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
