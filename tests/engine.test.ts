import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDeck,
  secureShuffle,
  dealHands,
  evaluateHand,
  compareHands,
  stakeFor,
  bootPot,
  type Card,
} from "../src/game/engine.ts";

const c = (rank: number, suit: Card["suit"] = "SPADES"): Card => ({ rank, suit });

test("deck has 52 unique cards", () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((x) => `${x.suit}-${x.rank}`)).size, 52);
});

test("shuffle keeps 52 unique cards", () => {
  const s = secureShuffle(createDeck());
  assert.equal(new Set(s.map((x) => `${x.suit}-${x.rank}`)).size, 52);
});

test("deal: 6 players x 3 cards, no duplicates, valid table sizes", () => {
  const hands = dealHands(6);
  assert.equal(hands.length, 6);
  const all = hands.flat();
  assert.equal(all.length, 18);
  assert.equal(new Set(all.map((x) => `${x.suit}-${x.rank}`)).size, 18);
  assert.throws(() => dealHands(1));
  assert.throws(() => dealHands(7));
});

test("categories are detected correctly", () => {
  assert.equal(evaluateHand([c(14), c(14, "HEARTS"), c(14, "CLUBS")]).category, "TRAIL");
  assert.equal(
    evaluateHand([c(12), c(13), c(14)]).category, // AKQ same suit (SPADES default)
    "PURE_SEQUENCE",
  );
  assert.equal(
    evaluateHand([c(12), c(13, "HEARTS"), c(14)]).category,
    "SEQUENCE",
  );
  assert.equal(
    evaluateHand([c(2), c(6), c(11)]).category, // same suit, not a sequence
    "COLOR",
  );
  assert.equal(
    evaluateHand([c(9), c(9, "HEARTS"), c(4)]).category,
    "PAIR",
  );
  assert.equal(
    evaluateHand([c(2), c(6, "HEARTS"), c(11)]).category,
    "HIGH_CARD",
  );
});

test("category order: Trail > Pure Sequence > Sequence > Color > Pair > High Card", () => {
  const trail = [c(2), c(2, "HEARTS"), c(2, "CLUBS")]; // weakest trail
  const pureSeq = [c(12), c(13), c(14)]; // strongest pure sequence
  const seq = [c(12), c(13, "HEARTS"), c(14, "CLUBS")];
  const color = [c(14), c(13), c(9)]; // same suit, not a sequence
  const pair = [c(14), c(14, "HEARTS"), c(13, "CLUBS")]; // strongest pair + kicker
  const high = [c(14), c(13, "HEARTS"), c(11, "CLUBS")];
  assert.equal(compareHands(trail, pureSeq), 1);
  assert.equal(compareHands(pureSeq, seq), 1);
  assert.equal(compareHands(seq, color), 1);
  assert.equal(compareHands(color, pair), 1);
  assert.equal(compareHands(pair, high), 1);
});

test("sequence order: AKQ > A23 > KQJ > 432", () => {
  const akq = [c(14), c(13, "HEARTS"), c(12, "CLUBS")];
  const a23 = [c(14), c(2, "HEARTS"), c(3, "CLUBS")];
  const kqj = [c(13), c(12, "HEARTS"), c(11, "CLUBS")];
  const low = [c(4), c(3, "HEARTS"), c(2, "CLUBS")];
  assert.equal(compareHands(akq, a23), 1);
  assert.equal(compareHands(a23, kqj), 1);
  assert.equal(compareHands(kqj, low), 1);
});

test("trail order: AAA beats 222", () => {
  assert.equal(
    compareHands(
      [c(14), c(14, "HEARTS"), c(14, "CLUBS")],
      [c(2), c(2, "HEARTS"), c(2, "CLUBS")],
    ),
    1,
  );
});

test("pair: higher pair wins, kicker breaks ties", () => {
  const pairK = [c(13), c(13, "HEARTS"), c(2, "CLUBS")];
  const pairQ = [c(12), c(12, "HEARTS"), c(14, "CLUBS")];
  assert.equal(compareHands(pairK, pairQ), 1);
  const pairA9 = [c(14), c(14, "HEARTS"), c(9, "CLUBS")];
  const pairA5 = [c(14, "DIAMONDS"), c(14, "CLUBS"), c(5, "HEARTS")];
  assert.equal(compareHands(pairA9, pairA5), 1);
});

test("betting maths: seen stakes double blind, boot pot sums all players", () => {
  assert.equal(stakeFor(10, false), 10);
  assert.equal(stakeFor(10, true), 20);
  assert.equal(bootPot(6, 10), 60);
  assert.equal(bootPot(2, 50), 100);
});
