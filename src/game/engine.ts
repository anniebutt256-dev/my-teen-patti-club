// MY TEEN PATTI CLUB — core game-rules engine (pure, server-side only)
// No I/O, no framework: the realtime layer and tests both use this module.
// Cards are never generated or evaluated on the client.

import { randomInt } from "node:crypto";

export type Suit = "SPADES" | "HEARTS" | "DIAMONDS" | "CLUBS";

export interface Card {
  suit: Suit;
  rank: number; // 2..14 (11=J, 12=Q, 13=K, 14=A)
}

const SUITS: Suit[] = ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"];

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) deck.push({ suit, rank });
  }
  return deck;
}

/** Fisher–Yates shuffle driven by a CSPRNG. Server-side only. */
export function secureShuffle(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** Deal 3 cards to each of n players from a freshly shuffled deck. */
export function dealHands(playerCount: number): Card[][] {
  if (playerCount < 2 || playerCount > 6) {
    throw new Error("Classic Teen Patti table seats 2-6 players");
  }
  const deck = secureShuffle(createDeck());
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  for (let round = 0; round < 3; round++) {
    for (let p = 0; p < playerCount; p++) {
      hands[p].push(deck[round * playerCount + p]);
    }
  }
  return hands;
}

// ---------------------------------------------------------------- hand ranking
// Strongest -> weakest: TRAIL, PURE_SEQUENCE, SEQUENCE, COLOR, PAIR, HIGH_CARD

export type HandCategory =
  | "TRAIL"
  | "PURE_SEQUENCE"
  | "SEQUENCE"
  | "COLOR"
  | "PAIR"
  | "HIGH_CARD";

const CATEGORY_STRENGTH: Record<HandCategory, number> = {
  TRAIL: 6,
  PURE_SEQUENCE: 5,
  SEQUENCE: 4,
  COLOR: 3,
  PAIR: 2,
  HIGH_CARD: 1,
};

/**
 * Sequence strength for a sorted-distinct rank triple, or 0 if not a sequence.
 * Teen Patti order: AKQ > A23 > KQJ > QJT > JT9 > T98 > 987 > 876 > 765 > 654 > 543 > 432.
 */
function sequenceStrength(ranksAsc: number[]): number {
  const key = ranksAsc.join(",");
  const ORDER = [
    "2,3,14", // A23 — second strongest
    "12,13,14", // AKQ — strongest, handled below
    "11,12,13", // KQJ
    "10,11,12", // QJT
    "9,10,11", // JT9
    "8,9,10", // T98
    "7,8,9",
    "6,7,8",
    "5,6,7",
    "4,5,6",
    "3,4,5",
    "2,3,4", // 432 — weakest
  ];
  const idx = ORDER.indexOf(key);
  if (idx === -1) return 0;
  if (key === "12,13,14") return 13; // AKQ tops the list
  if (key === "2,3,14") return 12; // A23 second
  return 13 - idx; // KQJ (idx 2) = 11 down to 432 (idx 11) = 2
}

export interface EvaluatedHand {
  category: HandCategory;
  /** Comparable score: larger wins. Category dominates, then in-category tiebreakers. */
  score: number;
  ranksDesc: number[];
}

export function evaluateHand(cards: Card[]): EvaluatedHand {
  if (cards.length !== 3) throw new Error("A Teen Patti hand has exactly 3 cards");
  const ranks = cards.map((c) => c.rank);
  const ranksAsc = [...ranks].sort((a, b) => a - b);
  const ranksDesc = [...ranks].sort((a, b) => b - a);
  const sameSuit = cards.every((c) => c.suit === cards[0].suit);
  const distinct = new Set(ranks).size;
  const seq = distinct === 3 ? sequenceStrength(ranksAsc) : 0;

  let category: HandCategory;
  let tiebreak = 0;

  if (distinct === 1) {
    category = "TRAIL"; // AAA highest ... 222 lowest
    tiebreak = ranks[0];
  } else if (seq > 0 && sameSuit) {
    category = "PURE_SEQUENCE";
    tiebreak = seq;
  } else if (seq > 0) {
    category = "SEQUENCE";
    tiebreak = seq;
  } else if (sameSuit) {
    category = "COLOR"; // flush, not a sequence: compare ranks high -> low
    tiebreak = ranksDesc[0] * 10000 + ranksDesc[1] * 100 + ranksDesc[2];
  } else if (distinct === 2) {
    category = "PAIR"; // pair rank dominates, kicker breaks ties
    const pairRank = ranksAsc[1]; // middle card is always part of the pair in a 3-card pair
    const kicker = ranks.find((r) => r !== pairRank) ?? 0;
    tiebreak = pairRank * 100 + kicker;
  } else {
    category = "HIGH_CARD";
    tiebreak = ranksDesc[0] * 10000 + ranksDesc[1] * 100 + ranksDesc[2];
  }

  return {
    category,
    score: CATEGORY_STRENGTH[category] * 1_000_000 + tiebreak,
    ranksDesc,
  };
}

/** Returns 1 if a beats b, -1 if b beats a, 0 on a true tie. */
export function compareHands(a: Card[], b: Card[]): number {
  const ea = evaluateHand(a);
  const eb = evaluateHand(b);
  if (ea.score !== eb.score) return ea.score > eb.score ? 1 : -1;
  return 0;
}

// ---------------------------------------------------------------- betting maths

/** Classic ratio: a Seen player stakes 2x a Blind player at the same chaal level. */
export function stakeFor(baseStake: number, seen: boolean): number {
  return seen ? baseStake * 2 : baseStake;
}

/** Boot is collected from every seated player before dealing. */
export function bootPot(playerCount: number, bootAmount: number): number {
  return playerCount * bootAmount;
}
