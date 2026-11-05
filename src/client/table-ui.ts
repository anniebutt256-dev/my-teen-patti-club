// Pure table-UI helpers (Phase 4) — no React, no I/O, so they are unit-tested
// directly. The table screen uses them to render cards, lay out the six
// seats around the felt from the viewer's perspective, and decide which
// action buttons are live. The server remains the authority: these flags
// only mirror its rules so the UI never offers an action it would reject.

import type { Card, Suit } from "../game/engine";

export function rankLabel(rank: number): string {
  if (rank === 14) return "A";
  if (rank === 13) return "K";
  if (rank === 12) return "Q";
  if (rank === 11) return "J";
  return String(rank);
}

const SUIT_SYMBOLS: Record<Suit, string> = {
  SPADES: "♠",
  HEARTS: "♥",
  DIAMONDS: "♦",
  CLUBS: "♣",
};

export function suitSymbol(suit: Suit): string {
  return SUIT_SYMBOLS[suit];
}

export function suitIsRed(suit: Suit): boolean {
  return suit === "HEARTS" || suit === "DIAMONDS";
}

export function cardLabel(card: Card): string {
  return `${rankLabel(card.rank)}${suitSymbol(card.suit)}`;
}

/**
 * Seat layout: slot 0 is always the viewer's own seat (bottom centre).
 * Other seats run clockwise by seat number relative to the viewer.
 */
export function relativeSlot(viewerSeat: number, seat: number, maxSeats = 6): number {
  return (((seat - viewerSeat) % maxSeats) + maxSeats) % maxSeats;
}

export interface SlotPosition {
  left?: string;
  right?: string;
  top?: string;
  bottom?: string;
  transform?: string;
}

/** CSS positions for slots 0..5 around the oval felt. */
export const SLOT_POSITIONS: SlotPosition[] = [
  { left: "50%", bottom: "1%", transform: "translateX(-50%)" }, // viewer
  { left: "3%", bottom: "20%" },
  { left: "3%", top: "9%" },
  { left: "50%", top: "1%", transform: "translateX(-50%)" },
  { right: "3%", top: "9%" },
  { right: "3%", bottom: "20%" },
];

export interface ActionAvailability {
  seen: boolean;
  chaal: boolean;
  pack: boolean;
  show: boolean;
  sideshow: boolean;
}

export interface ActionContext {
  roundActive: boolean;
  isMyTurn: boolean;
  myPacked: boolean;
  mySeen: boolean;
  activePlayers: number;
  previousSeen: boolean; // the active player before me has seen their cards
}

export function availableActions(ctx: ActionContext): ActionAvailability {
  const base = ctx.roundActive && ctx.isMyTurn && !ctx.myPacked;
  return {
    seen: base && !ctx.mySeen,
    chaal: base,
    pack: base,
    show: base && ctx.activePlayers === 2,
    sideshow: base && ctx.mySeen && ctx.activePlayers >= 3 && ctx.previousSeen,
  };
}

/** Initials for an avatar disc from a username/display name. */
export function avatarInitials(name: string): string {
  const parts = name.trim().split(/[\s_]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
