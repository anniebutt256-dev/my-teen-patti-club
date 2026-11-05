import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SLOT_POSITIONS,
  avatarInitials,
  availableActions,
  cardLabel,
  rankLabel,
  relativeSlot,
  suitIsRed,
  suitSymbol,
} from "../src/client/table-ui.ts";

test("cards: rank and suit labels render like a real deck", () => {
  assert.equal(rankLabel(14), "A");
  assert.equal(rankLabel(13), "K");
  assert.equal(rankLabel(12), "Q");
  assert.equal(rankLabel(11), "J");
  assert.equal(rankLabel(10), "10");
  assert.equal(rankLabel(2), "2");
  assert.equal(suitSymbol("SPADES"), "♠");
  assert.equal(suitSymbol("HEARTS"), "♥");
  assert.equal(cardLabel({ rank: 14, suit: "HEARTS" }), "A♥");
  assert.equal(cardLabel({ rank: 9, suit: "CLUBS" }), "9♣");
  assert.equal(suitIsRed("DIAMONDS"), true);
  assert.equal(suitIsRed("SPADES"), false);
});

test("seats: the viewer always sits in slot 0, others run clockwise", () => {
  assert.equal(SLOT_POSITIONS.length, 6);
  for (let viewer = 0; viewer < 6; viewer++) {
    assert.equal(relativeSlot(viewer, viewer), 0);
    assert.equal(relativeSlot(viewer, (viewer + 1) % 6), 1);
    assert.equal(relativeSlot(viewer, (viewer + 5) % 6), 5);
  }
  // every seat maps to a distinct slot for any viewer
  for (let viewer = 0; viewer < 6; viewer++) {
    const slots = [0, 1, 2, 3, 4, 5].map((s) => relativeSlot(viewer, s));
    assert.equal(new Set(slots).size, 6);
  }
});

test("actions: nothing is live when it is not your turn or no round runs", () => {
  const off = availableActions({
    roundActive: false,
    isMyTurn: false,
    myPacked: false,
    mySeen: false,
    activePlayers: 3,
    previousSeen: true,
  });
  assert.deepEqual(off, { seen: false, chaal: false, pack: false, show: false, sideshow: false });

  const notMyTurn = availableActions({
    roundActive: true,
    isMyTurn: false,
    myPacked: false,
    mySeen: false,
    activePlayers: 2,
    previousSeen: true,
  });
  assert.ok(!notMyTurn.chaal && !notMyTurn.pack && !notMyTurn.show);

  const packed = availableActions({
    roundActive: true,
    isMyTurn: true,
    myPacked: true,
    mySeen: true,
    activePlayers: 2,
    previousSeen: true,
  });
  assert.ok(!packed.chaal && !packed.pack);
});

test("actions: blind player can see/chaal/pack but not side show; show needs two active", () => {
  const blind3 = availableActions({
    roundActive: true,
    isMyTurn: true,
    myPacked: false,
    mySeen: false,
    activePlayers: 3,
    previousSeen: true,
  });
  assert.deepEqual(blind3, { seen: true, chaal: true, pack: true, show: false, sideshow: false });

  const seen3 = availableActions({
    roundActive: true,
    isMyTurn: true,
    myPacked: false,
    mySeen: true,
    activePlayers: 3,
    previousSeen: true,
  });
  assert.equal(seen3.seen, false); // already seen
  assert.equal(seen3.sideshow, true);
  assert.equal(seen3.show, false);

  const prevBlind = availableActions({
    roundActive: true,
    isMyTurn: true,
    myPacked: false,
    mySeen: true,
    activePlayers: 3,
    previousSeen: false,
  });
  assert.equal(prevBlind.sideshow, false); // side show target must be seen

  const final2 = availableActions({
    roundActive: true,
    isMyTurn: true,
    myPacked: false,
    mySeen: true,
    activePlayers: 2,
    previousSeen: true,
  });
  assert.equal(final2.show, true);
  assert.equal(final2.sideshow, false);
});

test("avatars: initials come from the display name", () => {
  assert.equal(avatarInitials("player_one"), "PO");
  assert.equal(avatarInitials("Ahmed Khan"), "AK");
  assert.equal(avatarInitials("zara"), "ZA");
  assert.equal(avatarInitials("  "), "?");
});
