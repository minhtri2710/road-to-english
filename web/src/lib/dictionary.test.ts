import { afterEach, describe, expect, it, vi } from "vitest";

import { lookupWord } from "./dictionary";

const fetchMock = vi.fn<typeof fetch>();

function respond(body: unknown, status = 200): void {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
}

const entry = {
  word: "hello",
  phonetic: "/həˈləʊ/",
  phonetics: [{ text: "/other/" }],
  meanings: [
    { partOfSpeech: "exclamation", definitions: [{ definition: "Used as a greeting." }, { definition: "Second." }] },
    { partOfSpeech: "noun", definitions: [{ definition: "Ignored." }] },
  ],
};

describe("lookupWord", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("parses the first entry's phonetic, part of speech and definition", async () => {
    respond([entry]);
    await expect(lookupWord("hello")).resolves.toEqual({
      phonetic: "/həˈləʊ/",
      partOfSpeech: "exclamation",
      definition: "Used as a greeting.",
    });
  });

  it("falls back to the first non-empty phonetics text, else omits the phonetic", async () => {
    respond([{ ...entry, phonetic: undefined, phonetics: [{ audio: "x" }, { text: "" }, { text: "/fb/" }] }]);
    await expect(lookupWord("hello")).resolves.toMatchObject({ phonetic: "/fb/" });

    respond([{ ...entry, phonetic: undefined, phonetics: [] }]);
    const result = await lookupWord("hello");
    expect(result).toEqual({ partOfSpeech: "exclamation", definition: "Used as a greeting." });
  });

  it("requests the encoded word URL without credentials or referrer", async () => {
    respond([entry]);
    await lookupWord("a b");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent("a b"));
    expect(url).toBe("https://api.dictionaryapi.dev/api/v2/entries/en/a%20b");
    expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toBeUndefined();
    expect(init?.body).toBeUndefined();
  });

  it("returns null on 404", async () => {
    respond({ title: "No Definitions Found" }, 404);
    await expect(lookupWord("zzz")).resolves.toBeNull();
  });

  it("rejects when fetch rejects, so the caller can tell offline from no definition", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(lookupWord("hello")).rejects.toThrow("Failed to fetch");
  });

  it("rejects on timeout and abort", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(lookupWord("hello")).rejects.toMatchObject({ name: "TimeoutError" });

    fetchMock.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    await expect(lookupWord("hello")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects on a server error", async () => {
    respond({}, 503);
    await expect(lookupWord("hello")).rejects.toThrow("Dictionary request failed (503).");
  });

  it("keeps the apostrophe in the requested word", async () => {
    respond([entry]);
    await lookupWord("don't");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.dictionaryapi.dev/api/v2/entries/en/don't");
  });

  it("returns null on invalid JSON", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(lookupWord("hello")).resolves.toBeNull();
  });

  it.each([
    ["empty array", []],
    ["empty entry", [{}]],
    ["non-string definition", [{ ...entry, meanings: [{ partOfSpeech: "noun", definitions: [{ definition: 42 }] }] }]],
    ["non-string part of speech", [{ ...entry, meanings: [{ partOfSpeech: 1, definitions: [{ definition: "x" }] }] }]],
    ["object instead of array", { meanings: [] }],
  ])("returns null for the wrong shape: %s", async (_name, body) => {
    respond(body);
    await expect(lookupWord("hello")).resolves.toBeNull();
  });
});
