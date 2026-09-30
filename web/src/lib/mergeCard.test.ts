import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { deleteCard, reviewCard, Rating, type VocabCard } from "./vocab";
import { mergeCard } from "./mergeCard";
import { card } from "../test/fixtures";

const times = {
  earlier: "2026-01-02T00:00:00.000Z",
  later: "2026-01-04T00:00:00.000Z",
  reviewEarly: "2026-01-03T00:00:00.000Z",
  reviewLate: "2026-01-05T00:00:00.000Z",
} as const;

type HistoryName = "fresh" | "reviewed" | "reviewedMore";
type CardVector = {
  front: string;
  updatedAt: "earlier" | "later";
  history: HistoryName;
  lastReview?: "reviewEarly" | "reviewLate";
  deletedAt?: "earlier" | "later";
};
type MergeRuleCase = {
  name: string;
  symmetric: boolean;
  stored: CardVector;
  incoming: CardVector;
  want: CardVector;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}

function validateCardVector(rowName: string, field: string, value: unknown): asserts value is CardVector {
  if (!isRecord(value) || !hasOnlyKeys(value, ["front", "updatedAt", "history"], ["lastReview", "deletedAt"]) || typeof value.front !== "string" || value.front === "") {
    throw new Error(`merge-rule row ${JSON.stringify(rowName)} has invalid ${field}.front`);
  }
  if (value.updatedAt !== "earlier" && value.updatedAt !== "later") {
    throw new Error(`merge-rule row ${JSON.stringify(rowName)} has invalid ${field}.updatedAt`);
  }
  if (value.history !== "fresh" && value.history !== "reviewed" && value.history !== "reviewedMore") {
    throw new Error(`merge-rule row ${JSON.stringify(rowName)} has invalid ${field}.history`);
  }
  if (value.history === "fresh" && value.lastReview !== undefined) {
    throw new Error(`merge-rule row ${JSON.stringify(rowName)} fresh history must not have lastReview`);
  }
  if (value.history !== "fresh" && value.lastReview !== "reviewEarly" && value.lastReview !== "reviewLate") {
    throw new Error(`merge-rule row ${JSON.stringify(rowName)} has invalid or missing ${field}.lastReview`);
  }
  if (value.deletedAt !== undefined && value.deletedAt !== "earlier" && value.deletedAt !== "later") {
    throw new Error(`merge-rule row ${JSON.stringify(rowName)} has invalid ${field}.deletedAt`);
  }
  if (value.deletedAt !== undefined && value.deletedAt !== value.updatedAt) {
    throw new Error(`merge-rule row ${JSON.stringify(rowName)} has deletedAt different from updatedAt`);
  }
}

const fixture: unknown = JSON.parse(
  readFileSync(`${import.meta.dirname}/../../../api/internal/storage/testdata/merge-rule.json`, "utf8"),
);
if (!isRecord(fixture) || !hasOnlyKeys(fixture, ["_comment", "cases"]) || typeof fixture._comment !== "string" || fixture._comment === "" || !Array.isArray(fixture.cases)) {
  throw new Error("invalid shared merge-rule fixture envelope");
}
if (fixture.cases.length !== 13) {
  throw new Error(`loaded ${fixture.cases.length} shared merge-rule rows, want 13`);
}
const names = new Set<string>();
const cases = fixture.cases.map((value, index): MergeRuleCase => {
  if (!isRecord(value)) {
    throw new Error(`shared merge-rule row ${index} is not an object`);
  }
  if (typeof value.name !== "string" || value.name === "") {
    throw new Error(`shared merge-rule row ${index} has a missing, non-string or empty name`);
  }
  if (names.has(value.name)) {
    throw new Error(`shared merge-rule rows have duplicate name ${JSON.stringify(value.name)}`);
  }
  names.add(value.name);
  const rowKeys = ["name", "symmetric", "stored", "incoming", "want"];
  const missing = rowKeys.filter((key) => !(key in value));
  const unknown = Object.keys(value).filter((key) => !rowKeys.includes(key));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(`merge-rule row ${JSON.stringify(value.name)} has missing keys ${JSON.stringify(missing)} and unknown keys ${JSON.stringify(unknown)}`);
  }
  if (typeof value.symmetric !== "boolean") {
    throw new Error(`merge-rule row ${JSON.stringify(value.name)} has invalid symmetric`);
  }
  validateCardVector(value.name, "stored", value.stored);
  validateCardVector(value.name, "incoming", value.incoming);
  validateCardVector(value.name, "want", value.want);
  if (value.stored.history !== "fresh" && value.incoming.history !== "fresh" && value.stored.history === value.incoming.history && value.stored.lastReview === value.incoming.lastReview) {
    throw new Error(`merge-rule row ${JSON.stringify(value.name)} stored and incoming share history and lastReview, so a winner/loser swap would go unseen`);
  }
  return value as MergeRuleCase;
});

function fresh(front: string, updatedAt: "earlier" | "later"): VocabCard {
  return card("sentence-1", new Date(times[updatedAt]), { front });
}

function reviewed(front: string, updatedAt: "earlier" | "later", history: "reviewed" | "reviewedMore", lastReview: "reviewEarly" | "reviewLate"): VocabCard {
  const reps = history === "reviewed" ? 3 : 5;
  const lastReviewTime = new Date(times[lastReview]);
  let value = fresh(front, "earlier");
  for (let index = 1; index < reps; index += 1) {
    value = reviewCard(value, Rating.Good, new Date(Date.parse(value.updatedAt) + 60_000));
  }
  value = reviewCard(value, Rating.Good, lastReviewTime);
  return { ...value, updatedAt: times[updatedAt] };
}

function build(vector: CardVector): VocabCard {
  const value = vector.history === "fresh"
    ? fresh(vector.front, vector.updatedAt)
    : reviewed(vector.front, vector.updatedAt, vector.history, vector.lastReview!);
  return vector.deletedAt === undefined ? value : deleteCard(value, new Date(times[vector.deletedAt]));
}

describe("mergeCard", () => {
  it.each(cases)("$name", ({ stored, incoming, want }) => {
    expect(mergeCard(build(stored), build(incoming))).toEqual(build(want));
  });

  it.each(cases.filter(({ symmetric }) => symmetric))("symmetric: $name", ({ stored, incoming, want }) => {
    expect(mergeCard(build(incoming), build(stored))).toEqual(build(want));
  });

  it("compares instants, not strings", () => {
    const incoming = { ...deleteCard(reviewed("b", "earlier", "reviewed", "reviewEarly"), new Date(times.later)), updatedAt: "2026-01-04T00:00:00Z" };
    expect(mergeCard(reviewed("a", "later", "reviewed", "reviewLate"), incoming)).toBe(incoming);
  });
});
