import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryStore, type UserRecord } from "../src/server/store.ts";
import { DevSmsSender, OtpService } from "../src/server/otp.ts";
import { WalletService } from "../src/server/wallet.ts";
import { AuthService } from "../src/server/auth.ts";
import { RoomService } from "../src/server/rooms.ts";
import { GameService, type Round } from "../src/server/game.ts";

// Phase 6 simulation gate (service level): six bot-driven players play many
// full rounds against the real services. After every round the chips must
// be exactly conserved and the ledger must explain every balance.

function setup() {
  const store = new InMemoryStore();
  const sms = new DevSmsSender();
  const otp = new OtpService(store, sms);
  const wallet = new WalletService(store);
  const auth = new AuthService(store, otp, wallet);
  const rooms = new RoomService(store);
  const game = new GameService(wallet, rooms, store);
  return { store, sms, wallet, auth, rooms, game };
}

/** Deterministic PRNG so the simulation is reproducible run to run. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let mobileSeq = 200;
async function makeUser(ctx: ReturnType<typeof setup>, username: string): Promise<UserRecord> {
  mobileSeq += 1;
  const mobile = `+92333333${String(mobileSeq).padStart(4, "0")}`;
  await ctx.auth.requestOtp(mobile);
  const code = ctx.sms.lastCode.get(mobile)!;
  const { user } = await ctx.auth.verifyAndLogin(mobile, code, { username });
  return user;
}

async function balances(ctx: ReturnType<typeof setup>, users: UserRecord[]) {
  const map = new Map<string, number>();
  for (const u of users) map.set(u.id, await ctx.wallet.getBalance(u.id));
  return map;
}

test("simulation: 25 six-player rounds conserve chips; ledger explains every balance", async () => {
  const ctx = setup();
  const rng = mulberry32(20261104);
  const users: UserRecord[] = [];
  for (let i = 0; i < 6; i++) users.push(await makeUser(ctx, `sim_${i}`));
  const host = users[0];
  const room = await ctx.rooms.createRoom(host, { bootAmount: 10 });
  for (const u of users.slice(1)) await ctx.rooms.joinRoom(u, room.code);

  let totalChips = 60_000;
  let showdowns = 0;
  let sideShows = 0;

  for (let roundNo = 1; roundNo <= 25; roundNo++) {
    // A player who has played down to almost nothing tops up between rounds
    // (a ledger grant, exactly like an admin grant) so the table can go on.
    for (const u of users) {
      const bal = await ctx.wallet.getBalance(u.id);
      if (bal < 100) {
        await ctx.wallet.applyMovement(u.id, "ADMIN_GRANT", 1000, `sim-topup:${roundNo}:${u.id}`, "Simulation top-up");
        totalChips += 1000;
      }
    }
    const before = await balances(ctx, users);
    const round: Round = await ctx.game.startRound(host.id, room);
    assert.equal(round.pot, 60);

    let steps = 0;
    while (round.status === "BETTING" && steps < 400) {
      steps++;
      const turnId = round.turnUserId!;
      const me = round.players.find((p) => p.userId === turnId)!;
      const active = round.players.filter((p) => !p.packed);
      const roll = rng();
      try {
        if (active.length === 2 && roll < 0.45) {
          await ctx.game.act(turnId, room, { type: "show" });
          showdowns++;
        } else if (!me.seen && roll < 0.35) {
          await ctx.game.act(turnId, room, { type: "seen" });
        } else if (
          me.seen &&
          active.length >= 3 &&
          roll < 0.18 &&
          (() => {
            const idx = active.findIndex((p) => p.userId === turnId);
            const prev = active[(idx - 1 + active.length) % active.length];
            return prev.seen;
          })()
        ) {
          await ctx.game.act(turnId, room, { type: "sideshow" });
          sideShows++;
        } else if (roll < 0.72) {
          await ctx.game.act(turnId, room, { type: "chaal", raise: rng() < 0.12 });
        } else if (me.totalBet > 150 || roll < 0.9) {
          await ctx.game.act(turnId, room, { type: "chaal" });
        } else {
          await ctx.game.act(turnId, room, { type: "pack" });
        }
      } catch (e) {
        if (e instanceof Error && e.message === "INSUFFICIENT_CHIPS") {
          await ctx.game.act(turnId, room, { type: "pack" });
        } else if (e instanceof Error && e.message === "STAKE_LIMIT_REACHED") {
          // A refused raise falls back to a plain chaal at the capped stake.
          try {
            await ctx.game.act(turnId, room, { type: "chaal" });
          } catch (e2) {
            if (e2 instanceof Error && e2.message === "INSUFFICIENT_CHIPS") {
              await ctx.game.act(turnId, room, { type: "pack" });
            } else {
              throw e2;
            }
          }
        } else {
          throw e;
        }
      }
    }

    assert.equal(round.status, "SETTLED", `round ${roundNo} did not settle in ${steps} steps`);
    const result = round.result!;
    const totalBet = round.players.reduce((s, p) => s + p.totalBet, 0);
    assert.equal(result.potWon, totalBet, `round ${roundNo}: pot != sum of bets`);

    const after = await balances(ctx, users);
    const sum = [...after.values()].reduce((a, b) => a + b, 0);
    assert.equal(sum, totalChips, `round ${roundNo}: chips not conserved`);
    for (const u of users) {
      const expected = before.get(u.id)! - round.players.find((p) => p.userId === u.id)!.totalBet + (result.winnerUserId === u.id ? result.potWon : 0);
      assert.equal(after.get(u.id), expected, `round ${roundNo}: balance mismatch for ${u.username}`);
    }
    assert.equal(room.status, "WAITING");
  }

  assert.ok(showdowns > 0, "simulation never reached a showdown");
  assert.ok(sideShows > 0, "simulation never used a side show");

  // Ledger audit: for every player, the full ledger sums to their balance,
  // no intermediate balance ever went negative, and per round the debits
  // exactly equal the winner's credit.
  const perRound = new Map<string, { debits: number; credits: number }>();
  for (const u of users) {
    const history = await ctx.wallet.history(u.id, 100_000);
    const sumAmounts = history.reduce((s, t) => s + t.amount, 0);
    assert.equal(sumAmounts, await ctx.wallet.getBalance(u.id), `ledger != balance for ${u.username}`);
    for (const t of history) assert.ok(t.balanceAfter >= 0, "negative balanceAfter in ledger");
    for (const t of history) {
      if (!t.roundId) continue;
      const agg = perRound.get(t.roundId) ?? { debits: 0, credits: 0 };
      if (t.amount < 0) agg.debits += -t.amount;
      if (t.type === "POT_WIN") agg.credits += t.amount;
      perRound.set(t.roundId, agg);
    }
  }
  assert.equal(perRound.size, 25);
  for (const [roundId, agg] of perRound) {
    assert.equal(agg.debits, agg.credits, `round ${roundId}: debits != pot credit`);
  }
});

test("simulation: in every round the six private hands are pairwise disjoint", async () => {
  const ctx = setup();
  const users: UserRecord[] = [];
  for (let i = 0; i < 6; i++) users.push(await makeUser(ctx, `deal_${i}`));
  const room = await ctx.rooms.createRoom(users[0], {});
  for (const u of users.slice(1)) await ctx.rooms.joinRoom(u, room.code);

  for (let r = 0; r < 3; r++) {
    await ctx.game.startRound(users[0].id, room);
    const seenCards = new Set<string>();
    for (const u of users) {
      const hand = ctx.game.privateHand(u.id, room.id)!;
      assert.equal(hand.cards.length, 3);
      for (const c of hand.cards) {
        const key = `${c.suit}-${c.rank}`;
        assert.ok(!seenCards.has(key), `duplicate card ${key} in one round`);
        seenCards.add(key);
      }
    }
    assert.equal(seenCards.size, 18);
    // End the round quickly: everyone packs to the first player.
    const round = ctx.game.activeRound(room.id)!;
    let guard = 0;
    while (round.status === "BETTING" && guard++ < 20) {
      await ctx.game.act(round.turnUserId!, room, { type: "pack" });
    }
    assert.equal(round.status, "SETTLED");
  }
});
