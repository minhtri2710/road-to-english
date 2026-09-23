import type { VocabCard } from "./vocab";

// ponytail: LWW on device wall-clock updatedAt, so clock skew between devices can pick the wrong write; upgrade = server-assigned per-card version.
// History-preserving LWW, the rule the api syncCard upsert implements: the newer updatedAt wins, and at equal time a tombstone beats a live card
// (a both-live or both-tombstone tie keeps `stored`). The winner is kept whole, except that a winner with fsrs.reps 0 takes the other
// copy's fsrs when that copy has reps > 0, so a fresh save never wipes review history.
export function mergeCard(stored: VocabCard, incoming: VocabCard): VocabCard {
  const storedTime = Date.parse(stored.updatedAt);
  const incomingTime = Date.parse(incoming.updatedAt);
  const incomingWins =
    incomingTime > storedTime ||
    (incomingTime === storedTime && incoming.deletedAt !== null && stored.deletedAt === null);
  const [winner, loser] = incomingWins ? [incoming, stored] : [stored, incoming];
  return winner.fsrs.reps === 0 && loser.fsrs.reps > 0 ? { ...winner, fsrs: loser.fsrs } : winner;
}
