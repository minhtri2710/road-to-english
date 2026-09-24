import { isRecord } from "./vocab";

export interface Definition {
  phonetic?: string;
  partOfSpeech: string;
  definition: string;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parse(body: unknown): Definition | null {
  if (!Array.isArray(body) || !isRecord(body[0])) return null;
  const entry = body[0];
  const meaning = Array.isArray(entry.meanings) ? entry.meanings[0] : undefined;
  if (!isRecord(meaning) || !nonEmptyString(meaning.partOfSpeech)) return null;
  const first = Array.isArray(meaning.definitions) ? meaning.definitions[0] : undefined;
  if (!isRecord(first) || !nonEmptyString(first.definition)) return null;

  const phonetic = nonEmptyString(entry.phonetic)
    ? entry.phonetic
    : (Array.isArray(entry.phonetics) ? entry.phonetics : [])
        .map((item) => (isRecord(item) ? item.text : undefined))
        .find(nonEmptyString);

  return {
    ...(phonetic ? { phonetic } : {}),
    partOfSpeech: meaning.partOfSpeech,
    definition: first.definition,
  };
}

// Sends only the word: no credentials, no referrer, no query string or body.
// Resolves null when the dictionary has no usable entry (a 404 or an unexpected body);
// rejects when the dictionary can't be reached (network failure, timeout, server error).
export async function lookupWord(word: string): Promise<Definition | null> {
  const response = await fetch(
    "https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word),
    { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(5000) },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Dictionary request failed (${response.status}).`);
  try {
    return parse(await response.json());
  } catch {
    return null;
  }
}
