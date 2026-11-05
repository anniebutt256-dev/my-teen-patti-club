// Game service (Phase 3) — the server-authoritative Teen Patti state machine.
//
// The server alone shuffles, deals, validates turns, moves chips and settles
// the pot (see ARCHITECTURE.md trust boundary). A player's cards live only in
// this module's round state and are handed out exclusively through
// privateHand() to that player — publicState() contains no cards at all.
//
// Every chip movement goes through WalletService with an idempotency key, so
// a replayed socket action can never double-debit or double-credit.
// Chip conservation invariant: during a round, (sum of player balances + pot)
// is constant; settlement credits the whole pot to exactly one winner.

import {
  compareHands,
  dealHands,
  evaluateHand,
  stakeFor,
  type Card,
} from "../game/engine";
import { newId, type Store } from "./store";
import { WalletService } from "./wallet";
import { MIN_SEATS_TO_START, RoomService, type RoomRecord } from "./rooms";

export type GameActionType = "chaal" | "pack" | "show" | "sideshow" | "seen";

export interface GameActionInput {
  type: GameActionType;
  raise?: boolean; // chaal only: double the current stake before betting
  actionId?: string; // client-supplied idempotency key for this action
}

export interface RoundPlayer {
  userId: string;
  seatNo: number;
  seen: boolean;
  packed: boolean;
  totalBet: number;
}

export interface RoundResult {
  winnerUserId: string;
  potWon: number;
  winningHand: string;
  revealed: { userId: string; cards: Card[]; category: string }[];
}

export interface Round {
  id: string;
  roomId: string;
  roundNo: number;
  status: "BETTING" | "SETTLED" | "ABORTED";
  pot: number;
  currentStake: number; // base chaal level; blind pays 1x, seen pays 2x
  turnUserId: string | null;
  players: RoundPlayer[];
  hands: Map<string, Card[]>; // SERVER ONLY — never serialised into public state
  processedKeys: Set<string>;
  actionSeq: number;
  result: RoundResult | null;
  createdAt: number;
}

export interface RoundPublic {
  id: string;
  roundNo: number;
  status: Round["status"];
  pot: number;
  currentStake: number;
  turnUserId: string | null;
  players: RoundPlayer[];
  result: RoundResult | null;
}

/** Stake may be raised at most to boot x this multiple, keeping pots bounded. */
export const MAX_STAKE_MULTIPLE = 32;

export class GameService {
  private wallet: WalletService;
  private rooms: RoomService;
  private store: Store;
  private active = new Map<string, Round>(); // roomId -> round
  private lastResult = new Map<string, RoundResult>();
  private roundCounters = new Map<string, number>();

  constructor(wallet: WalletService, rooms: RoomService, store: Store) {
    this.wallet = wallet;
    this.rooms = rooms;
    this.store = store;
  }

  activeRound(roomId: string): Round | null {
    return this.active.get(roomId) ?? null;
  }

  getLastResult(roomId: string): RoundResult | null {
    return this.lastResult.get(roomId) ?? null;
  }

  /** A player's own cards — the ONLY path cards ever leave the server. */
  privateHand(userId: string, roomId: string): { cards: Card[]; seen: boolean } | null {
    const round = this.active.get(roomId) ?? null;
    if (!round) {
      return null;
    }
    const player = round.players.find((p) => p.userId === userId);
    const cards = round.hands.get(userId);
    if (!player || !cards) return null;
    return { cards: [...cards], seen: player.seen };
  }

  async startRound(actorId: string, room: RoomRecord): Promise<Round> {
    if (room.ownerId !== actorId) throw new Error("NOT_HOST");
    if (room.status === "CLOSED") throw new Error("ROOM_NOT_FOUND");
    if (this.active.has(room.id)) throw new Error("ROUND_ALREADY_ACTIVE");
    const seats = [...room.seats].sort((a, b) => a.seatNo - b.seatNo);
    if (seats.length < MIN_SEATS_TO_START) throw new Error("NOT_ENOUGH_PLAYERS");

    // Pre-check every balance BEFORE debiting anyone: a failed start is atomic.
    for (const seat of seats) {
      const balance = await this.wallet.getBalance(seat.userId);
      if (balance < room.bootAmount) throw new Error("INSUFFICIENT_CHIPS");
    }

    const roundNo = (this.roundCounters.get(room.id) ?? 0) + 1;
    const round: Round = {
      id: newId("round"),
      roomId: room.id,
      roundNo,
      status: "BETTING",
      pot: 0,
      currentStake: room.bootAmount,
      turnUserId: null,
      players: seats.map((s) => ({
        userId: s.userId,
        seatNo: s.seatNo,
        seen: false,
        packed: false,
        totalBet: 0,
      })),
      hands: new Map(),
      processedKeys: new Set(),
      actionSeq: 0,
      result: null,
      createdAt: Date.now(),
    };

    const hands = dealHands(seats.length);
    seats.forEach((seat, i) => round.hands.set(seat.userId, hands[i]));

    const debited: string[] = [];
    try {
      for (const seat of seats) {
        await this.wallet.applyMovement(
          seat.userId,
          "BOOT",
          -room.bootAmount,
          `boot:${round.id}:${seat.userId}`,
          `Boot — round ${roundNo}`,
          round.id,
        );
        debited.push(seat.userId);
        const p = round.players.find((x) => x.userId === seat.userId)!;
        p.totalBet += room.bootAmount;
        round.pot += room.bootAmount;
      }
    } catch (e) {
      // Roll back any boot already taken so a failed start costs nobody chips.
      for (const userId of debited) {
        await this.wallet.applyMovement(
          userId,
          "REFUND",
          room.bootAmount,
          `refund:${round.id}:${userId}`,
          "Boot refund — round failed to start",
          round.id,
        );
      }
      throw e;
    }

    this.roundCounters.set(room.id, roundNo);
    // First turn: the seated player after the host (host deals).
    const hostIdx = seats.findIndex((s) => s.userId === room.ownerId);
    const first = seats[(hostIdx + 1) % seats.length];
    round.turnUserId = first.userId;

    room.status = "PLAYING";
    this.active.set(room.id, round);
    return round;
  }

  private activePlayers(round: Round): RoundPlayer[] {
    return round.players
      .filter((p) => !p.packed)
      .sort((a, b) => a.seatNo - b.seatNo);
  }

  private advanceTurn(round: Round, fromSeatNo: number) {
    const active = this.activePlayers(round);
    if (active.length === 0) {
      round.turnUserId = null;
      return;
    }
    const next = active.find((p) => p.seatNo > fromSeatNo) ?? active[0];
    round.turnUserId = next.userId;
  }

  private async debit(
    round: Round,
    player: RoundPlayer,
    amount: number,
    note: string,
    idemBase: string,
  ) {
    await this.wallet.applyMovement(
      player.userId,
      "CHAAL",
      -amount,
      idemBase,
      note,
      round.id,
    );
    player.totalBet += amount;
    round.pot += amount;
  }

  async act(
    userId: string,
    room: RoomRecord,
    action: GameActionInput,
  ): Promise<Round> {
    const round = this.active.get(room.id);
    if (!round || round.status !== "BETTING") throw new Error("ROUND_NOT_ACTIVE");
    const player = round.players.find((p) => p.userId === userId);
    if (!player) throw new Error("NOT_IN_ROUND");
    if (player.packed) throw new Error("ALREADY_PACKED");

    // Idempotent replay: a retried socket event returns current state and
    // never moves chips twice.
    const idemKey = action.actionId ? `${round.id}:${userId}:${action.actionId}` : null;
    if (idemKey && round.processedKeys.has(idemKey)) return round;

    if (round.turnUserId !== userId) throw new Error("NOT_YOUR_TURN");
    if (!["chaal", "pack", "show", "sideshow", "seen"].includes(action.type)) {
      throw new Error("INVALID_ACTION");
    }

    const walletKey = idemKey ?? `${round.id}:${userId}:seq:${++round.actionSeq}`;

    if (action.type === "seen") {
      player.seen = true; // looking at your cards costs nothing, keeps the turn
    } else if (action.type === "chaal") {
      let base = round.currentStake;
      if (action.raise) {
        base = round.currentStake * 2;
        if (base > room.bootAmount * MAX_STAKE_MULTIPLE) {
          throw new Error("STAKE_LIMIT_REACHED");
        }
      }
      const amount = stakeFor(base, player.seen);
      await this.debit(round, player, amount, action.raise ? "Chaal (raise)" : "Chaal", walletKey);
      if (action.raise) round.currentStake = base;
      this.advanceTurn(round, player.seatNo);
    } else if (action.type === "pack") {
      player.packed = true;
      const remaining = this.activePlayers(round);
      if (remaining.length === 1) {
        await this.settle(round, room, remaining[0].userId, []);
      } else {
        this.advanceTurn(round, player.seatNo);
      }
    } else if (action.type === "show") {
      const active = this.activePlayers(round);
      if (active.length !== 2) throw new Error("SHOW_REQUIRES_TWO_PLAYERS");
      const other = active.find((p) => p.userId !== userId)!;
      const amount = stakeFor(round.currentStake, player.seen);
      await this.debit(round, player, amount, "Show", walletKey);
      const cmp = compareHands(round.hands.get(userId)!, round.hands.get(other.userId)!);
      const loser = cmp > 0 ? other : player; // a tie also packs the requester
      loser.packed = true;
      const winner = loser.userId === userId ? other : player;
      await this.settle(round, room, winner.userId, [userId, other.userId]);
    } else if (action.type === "sideshow") {
      if (!player.seen) throw new Error("MUST_BE_SEEN_FOR_SIDE_SHOW");
      const active = this.activePlayers(round);
      if (active.length < 3) throw new Error("SIDE_SHOW_REQUIRES_THREE_PLAYERS");
      const idx = active.findIndex((p) => p.userId === userId);
      const previous = active[(idx - 1 + active.length) % active.length];
      if (!previous.seen) throw new Error("SIDE_SHOW_TARGET_NOT_SEEN");
      const amount = stakeFor(round.currentStake, player.seen);
      await this.debit(round, player, amount, "Side Show", walletKey);
      const cmp = compareHands(
        round.hands.get(userId)!,
        round.hands.get(previous.userId)!,
      );
      const loser = cmp > 0 ? previous : player; // a tie also packs the requester
      loser.packed = true;
      const remaining = this.activePlayers(round);
      if (remaining.length === 1) {
        await this.settle(round, room, remaining[0].userId, [userId, previous.userId]);
      } else {
        this.advanceTurn(round, player.seatNo);
      }
    }

    if (idemKey) round.processedKeys.add(idemKey);
    return round;
  }

  /**
   * Abort the live round (admin room close): every player's total bet for
   * this round is refunded through the ledger, so no chips are created or
   * destroyed. Returns the refunded total (0 when no round was live).
   */
  async abortRound(room: RoomRecord): Promise<number> {
    const round = this.active.get(room.id);
    if (!round) return 0;
    let refunded = 0;
    for (const p of round.players) {
      if (p.totalBet > 0) {
        await this.wallet.applyMovement(
          p.userId,
          "REFUND",
          p.totalBet,
          `abort-refund:${round.id}:${p.userId}`,
          "Round aborted by admin — bets refunded",
          round.id,
        );
        refunded += p.totalBet;
      }
    }
    round.status = "ABORTED";
    round.turnUserId = null;
    this.active.delete(room.id);
    if (room.status === "PLAYING") room.status = "WAITING";
    return refunded;
  }

  /** A seated player left mid-round: they pack and forfeit what they bet. */
  async handlePlayerLeft(userId: string, room: RoomRecord): Promise<Round | null> {
    const round = this.active.get(room.id);
    if (!round || round.status !== "BETTING") return round ?? null;
    const player = round.players.find((p) => p.userId === userId);
    if (!player || player.packed) return round;
    const wasTurn = round.turnUserId === userId;
    player.packed = true;
    const remaining = this.activePlayers(round);
    if (remaining.length === 1) {
      await this.settle(round, room, remaining[0].userId, []);
    } else if (wasTurn) {
      this.advanceTurn(round, player.seatNo);
    }
    return round;
  }

  private async settle(
    round: Round,
    room: RoomRecord,
    winnerUserId: string,
    revealUserIds: string[],
  ) {
    const winnerHand = round.hands.get(winnerUserId)!;
    const potWon = round.pot;
    if (potWon > 0) {
      await this.wallet.applyMovement(
        winnerUserId,
        "POT_WIN",
        potWon,
        `potwin:${round.id}:${winnerUserId}`,
        `Pot won — round ${round.roundNo}`,
        round.id,
      );
    }
    round.result = {
      winnerUserId,
      potWon,
      winningHand: evaluateHand(winnerHand).category,
      revealed: revealUserIds.map((uid) => ({
        userId: uid,
        cards: [...(round.hands.get(uid) ?? [])],
        category: evaluateHand(round.hands.get(uid)!).category,
      })),
    };
    round.status = "SETTLED";
    round.turnUserId = null;
    this.lastResult.set(room.id, round.result);
    this.active.delete(room.id);
    if (room.status === "PLAYING") room.status = "WAITING";
  }

  roundPublic(round: Round): RoundPublic {
    return {
      id: round.id,
      roundNo: round.roundNo,
      status: round.status,
      pot: round.pot,
      currentStake: round.currentStake,
      turnUserId: round.turnUserId,
      players: round.players.map((p) => ({ ...p })),
      result: round.result,
    };
  }

  /** Full public table state for one room — contains NO cards, ever. */
  async publicState(room: RoomRecord) {
    const view = await this.rooms.publicView(room);
    const round = this.active.get(room.id);
    const balances: Record<string, number> = {};
    for (const seat of room.seats) {
      balances[seat.userId] = await this.wallet.getBalance(seat.userId);
    }
    return {
      room: view,
      round: round ? this.roundPublic(round) : null,
      lastResult: this.getLastResult(room.id),
      balances,
    };
  }
}
