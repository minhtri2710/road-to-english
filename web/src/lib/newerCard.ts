import type { VocabCard } from "./vocab";

// ponytail: LWW on device wall-clock updatedAt, so clock skew between devices can pick the wrong write; upgrade = server-assigned per-card version.
// The api syncCard upsert WHERE implements this same rule.
export function newerCard(stored: VocabCard, incoming: VocabCard): boolean {
  const storedTime = Date.parse(stored.updatedAt);
  const incomingTime = Date.parse(incoming.updatedAt);
  return (
    incomingTime > storedTime ||
    (incomingTime === storedTime && incoming.deletedAt !== null && stored.deletedAt === null)
  );
}
