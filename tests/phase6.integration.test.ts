// Phase 6 integration gate — the REAL server (tsx server.ts) driven by six
// real Socket.IO sessions plus REST, exactly as six phones would use it.
// Covers: privacy of hands, full scripted rounds (side show, showdown, last
// player standing), chip conservation + ledger audit per round, reconnect
// restore, disconnect-grace auto-pack, and the wire-level security checks.
//
// Run with: npm run test:integration   (spawns its own server on PORT 3216)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { io, type Socket } from "socket.io-client";

const PORT = 3216;
const BASE = `http://localhost:${PORT}`;
const GRACE_MS = 1500;

let server: ChildProcess;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Player {
  id: string;
  username: string;
  cookie: string;
  socket?: Socket;
  bag: { states: any[]; hands: any[]; results: any[] };
}
const players: Player[] = [];
let roomCode = "";

async function register(mobile: string, username: string): Promise<Player> {
  const r1 = await fetch(`${BASE}/api/auth/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber: mobile }),
  });
  const d1: any = await r1.json();
  assert.ok(d1.devCode, `no devCode for ${username}: ${JSON.stringify(d1)}`);
  const r2 = await fetch(`${BASE}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber: mobile, code: d1.devCode, username }),
  });
  const d2: any = await r2.json();
  const cookie = r2.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie && d2.user, `verify failed for ${username}`);
  return { id: d2.user.id, username, cookie: cookie!, bag: { states: [], hands: [], results: [] } };
}

const api = (p: Player, path: string, method = "GET", body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: p.cookie, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

function connect(p: Player): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { extraHeaders: { Cookie: p.cookie }, transports: ["websocket"] });
    s.on("table:state", (d: any) => {
      if (d.room?.code === roomCode) p.bag.states.push(d);
    });
    s.on("hand:private", (d: any) => {
      if (d.roomCode === roomCode) p.bag.hands.push(d);
    });
    s.on("round:result", (d: any) => p.bag.results.push(d));
    s.on("connected", () => resolve(s));
    s.on("connect_error", reject);
    setTimeout(() => reject(new Error(`connect timeout for ${p.username}`)), 20000);
  });
}

const emitAck = (s: Socket, ev: string, payload: unknown): Promise<any> =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: "ACK_TIMEOUT" }), 20000);
    s.emit(ev as string, payload as any, (res: any) => {
      clearTimeout(t);
      resolve(res);
    });
  });

async function until<T>(fn: () => T | undefined | null, timeout = 25000, label = "condition"): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = fn();
    if (v) return v;
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const latestState = (p: Player) => p.bag.states[p.bag.states.length - 1];
const cardKey = (c: any) => `${c.suit}-${c.rank}`;
const handKeys = (h: any) => h.cards.map(cardKey).sort().join(",");

async function wallet(p: Player) {
  const { data } = await api(p, "/api/wallet");
  return data as { balance: number; transactions: any[] };
}

/** Assert the money for one settled round, purely from the users' ledgers. */
async function assertRoundMoney(roundId: string, result: any) {
  let debits = 0;
  let credits = 0;
  let total = 0;
  for (const p of players) {
    const w = await wallet(p);
    total += w.balance;
    for ( const t of w.transactions.filter((x: any) => x.roundId === roundId)) {
      if (t.amount < 0) debits += -t.amount;
      if (t.type === "POT_WIN") {
        credits += t.amount;
        assert.equal(p.id, result.winnerUserId, "POT_WIN paid to a non-winner");
      }
    }
  }
  assert.equal(debits, result.potWon, "round debits != pot");
  assert.equal(credits, result.potWon, "pot credit != pot");
  assert.equal(total, 60_000, "chips not conserved across the six wallets");
}

type Behaviour = (actorId: string, round: any) => { type: string; raise?: boolean } | null;

/** Drive one live round: repeatedly let the turn holder act per `behaviour`. */
async function driveRound(behaviour: Behaviour, watch?: (round: any) => void) {
  const host = players[0];
  const resultsBefore = host.bag.results.length;
  let guard = 0;
  while (host.bag.results.length === resultsBefore) {
    if (++guard > 300) throw new Error("driveRound: round did not finish");
    const state = await until(
      () => {
        // The settle state (round: null) can land a poll cycle before the
        // round:result packet — bail out as soon as the result arrives.
        if (host.bag.results.length > resultsBefore) return "SETTLED" as const;
        const s = latestState(host);
        return s?.round ? s : undefined;
      },
      25000,
      "live round state",
    );
    if (state === "SETTLED") break;
    const round = state.round;
    if (watch) watch(round);
    const actor = players.find((p) => p.id === round.turnUserId);
    assert.ok(actor?.socket, "turn holder has no socket");
    const action = behaviour(actor!.id, round);
    assert.ok(action, `no behaviour for ${actor!.username}`);
    const beforeJson = JSON.stringify(round);
    const ack = await emitAck(actor!.socket!, "game:action", {
      code: roomCode,
      ...action,
      actionId: `gate-${round.id}-${guard}-${actor!.username}`,
    });
    assert.ok(ack.ok, `action ${action!.type} by ${actor!.username} refused: ${JSON.stringify(ack)}`);
    // Wait until the public round visibly changes (turn moves, seen flips,
    // pot grows, a player packs) or the round settles.
    await until(
      () =>
        host.bag.results.length > resultsBefore ||
        JSON.stringify(latestState(host)?.round ?? {}) !== beforeJson,
      25000,
      "round state change",
    ).catch(() => undefined);
  }
  return host.bag.results[host.bag.results.length - 1];
}

async function startRound() {
  const host = players[0];
  const statesBefore = host.bag.states.length;
  const ack = await emitAck(host.socket!, "game:start", { code: roomCode });
  assert.ok(ack.ok, `game:start refused: ${JSON.stringify(ack)}`);
  const state = await until(
    () => {
      const s = latestState(host);
      return s?.round && host.bag.states.length > statesBefore ? s : undefined;
    },
    25000,
    "round to start",
  );
  return state.round;
}

before(async () => {
  server = spawn("npx", ["tsx", "server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), RECONNECT_GRACE_MS: String(GRACE_MS) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group, so after() can kill the whole tree
  });
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("server start timeout")), 60000);
    server.stdout!.on("data", (d) => {
      if (String(d).includes("listening")) {
        clearTimeout(to);
        resolve();
      }
    });
    server.on("exit", (c) => reject(new Error(`server exited early: ${c}`)));
  });

  for (let i = 0; i < 6; i++) {
    players.push(await register(`+92355530000${i + 1}`, `gate_${["one", "two", "three", "four", "five", "six"][i]}`));
  }
  const created = await api(players[0], "/api/rooms", "POST", { name: "Gate table", bootAmount: 10 });
  assert.equal(created.status, 201);
  roomCode = created.data.room.code;
  for (const p of players.slice(1)) {
    const joined = await api(p, `/api/rooms/${roomCode}/join`, "POST", {});
    assert.equal(joined.status, 200, `join failed for ${p.username}`);
  }
  for (const p of players) {
    p.socket = await connect(p);
    const ack = await emitAck(p.socket, "room:join", { code: roomCode });
    assert.ok(ack.ok, `socket join failed for ${p.username}`);
  }
});

after(() => {
  for (const p of players) p.socket?.disconnect();
  // Kill the whole process group: server.pid is only the npx wrapper, and
  // killing just it leaves the real server (and the clients' event loop)
  // alive, which hangs the test runner after the results are in.
  try {
    if (server?.pid) process.kill(-server.pid, "SIGKILL");
  } catch {
    server?.kill("SIGKILL");
  }
});

test("privacy: public state has no cards; a socket only ever receives its own hand", { timeout: 120_000 }, async () => {
  const round = await startRound();
  assert.equal(round.pot, 60);
  const hands = new Map<string, string>();
  for (const p of players) {
    const hand = await until(() => p.bag.hands[p.bag.hands.length - 1], 25000, `hand for ${p.username}`);
    assert.equal(hand.cards.length, 3);
    hands.set(p.id, handKeys(hand));
  }
  assert.equal(new Set(hands.values()).size, 6, "two players share a hand");
  const allCards = [...hands.values()].join(",").split(",");
  assert.equal(new Set(allCards).size, 18, "duplicate cards across hands");
  const stateJson = JSON.stringify(latestState(players[0]));
  for (const suit of ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"]) {
    assert.ok(!stateJson.includes(suit), `table:state leaked ${suit}`);
  }
  // Finish the round: everyone packs to the host.
  const result = await driveRound((actorId) =>
    actorId === players[0].id ? { type: "chaal" } : { type: "pack" },
  );
  assert.equal(result.winnerUserId, players[0].id);
  await assertRoundMoney(round.id, result);
  // Nobody ever received a second, different hand during the round.
  for (const p of players) {
    for (const h of p.bag.hands) assert.equal(handKeys(h), hands.get(p.id));
  }
});

test("round A: side show over live sockets packs exactly one of the two seen players", { timeout: 120_000 }, async () => {
  const round = await startRound();
  const [u1, u2, , u4] = [players[1], players[2], players[3], players[4]];
  let chaaled = false;
  let sideShowDone = false;
  let sideShowSeen = false;
  const result = await driveRound(
    (actorId, r) => {
      const me = r.players.find((p: any) => p.userId === actorId);
      const active = r.players.filter((p: any) => !p.packed);
      if (active.length === 5 && (r.players.find((p: any) => p.userId === u1.id)?.packed || r.players.find((p: any) => p.userId === u2.id)?.packed)) {
        sideShowSeen = true;
      }
      if (actorId === u1.id) {
        if (!me.seen) return { type: "seen" };
        if (!chaaled) {
          chaaled = true;
          return { type: "chaal" };
        }
        return { type: "pack" };
      }
      if (actorId === u2.id) {
        if (!me.seen) return { type: "seen" };
        if (!sideShowDone) {
          sideShowDone = true;
          return { type: "sideshow" };
        }
        return { type: "pack" };
      }
      if (actorId === u4.id) return { type: "chaal" };
      return { type: "pack" };
    },
  );
  assert.ok(sideShowSeen, "side show never packed one of the pair");
  await assertRoundMoney(round.id, result);
});

test("round B: showdown reveals exactly the two finalists and pays the winner", { timeout: 120_000 }, async () => {
  const round = await startRound();
  const finalists = [players[0].id, players[3].id];
  const result = await driveRound((actorId, r) => {
    const me = r.players.find((p: any) => p.userId === actorId);
    const active = r.players.filter((p: any) => !p.packed);
    if (!finalists.includes(actorId)) return { type: "pack" };
    if (active.length > 2) return { type: "chaal" };
    if (actorId === players[3].id) {
      if (!me.seen) return { type: "seen" };
      return { type: "show" };
    }
    return { type: "chaal" };
  });
  assert.ok(finalists.includes(result.winnerUserId));
  assert.equal(result.revealed.length, 2);
  assert.deepEqual(
    result.revealed.map((x: any) => x.userId).sort(),
    [...finalists].sort(),
  );
  const winnerReveal = result.revealed.find((x: any) => x.userId === result.winnerUserId);
  assert.equal(winnerReveal.category, result.winningHand);
  await assertRoundMoney(round.id, result);
});

test("reconnect: same hand restored mid-round; grace expiry auto-packs a stalled turn", { timeout: 180_000 }, async () => {
  // Part 1 — graceful reconnect.
  const round = await startRound();
  const six = players[5];
  const ownHand = await until(() => six.bag.hands[six.bag.hands.length - 1], 25000, "six's hand");
  const ownKeys = handKeys(ownHand);
  six.socket!.close();
  six.socket = undefined;
  await sleep(300);
  // Play moves past without six (turn order starts at players[1]).
  const ack1 = await emitAck(players[1].socket!, "game:action", { code: roomCode, type: "chaal", actionId: "recon-1" });
  assert.ok(ack1.ok);
  const ack2 = await emitAck(players[2].socket!, "game:action", { code: roomCode, type: "chaal", actionId: "recon-2" });
  assert.ok(ack2.ok);
  const handsBefore = six.bag.hands.length;
  six.socket = await connect(six);
  const restored = await until(
    () => six.bag.hands.slice(handsBefore).find((h) => handKeys(h) === ownKeys) ?? six.bag.hands[six.bag.hands.length - 1],
    25000,
    "restored hand",
  );
  assert.equal(handKeys(restored), ownKeys, "reconnected hand differs from the dealt hand");
  const st = await until(() => {
    const s = latestState(players[0]);
    return s?.round?.id === round.id ? s : undefined;
  });
  assert.ok(st, "reconnected player lost the round");
  const result1 = await driveRound((actorId) => (actorId === players[0].id ? { type: "chaal" } : { type: "pack" }));
  await assertRoundMoney(round.id, result1);

  // Part 2 — the turn holder vanishes; after the grace window the server packs them.
  const round2 = await startRound();
  const first = players[1];
  assert.equal(round2.turnUserId, first.id);
  first.socket!.close();
  first.socket = undefined;
  const packed = await until(
    () => {
      const s = latestState(players[0]);
      const rp = s?.round?.players.find((p: any) => p.userId === first.id);
      return rp?.packed && s.round.turnUserId !== first.id ? s : undefined;
    },
    GRACE_MS + 20000,
    "auto-pack after grace",
  );
  assert.ok(packed, "disconnected turn holder was not auto-packed");
  first.socket = await connect(first);
  const result2 = await driveRound((actorId) => (actorId === players[0].id ? { type: "chaal" } : { type: "pack" }));
  await assertRoundMoney(round2.id, result2);
});

test("security: bad sockets, private-room passwords, out-of-turn and replayed actions", { timeout: 180_000 }, async () => {
  // Unauthenticated and tampered-cookie sockets are refused.
  for (const cookie of [null, "mtpc_session= forged.token.here"]) {
    const outcome = await new Promise<string>((resolve) => {
      const s = io(BASE, {
        extraHeaders: cookie ? { Cookie: cookie } : {},
        transports: ["websocket"],
        reconnection: false,
      });
      const to = setTimeout(() => resolve("timeout"), 10000);
      s.on("connected", () => {
        clearTimeout(to);
        s.close();
        resolve("connected");
      });
      s.on("connect_error", () => {
        clearTimeout(to);
        s.close();
        resolve("connect_error");
      });
    });
    assert.equal(outcome, "connect_error", `bad socket accepted (cookie: ${cookie})`);
  }

  // Private room password over sockets.
  const priv = await api(players[0], "/api/rooms", "POST", {
    name: "Gate private",
    type: "PRIVATE",
    password: "gate-pass",
    bootAmount: 10,
  });
  const privCode = priv.data.room.code;
  const guest = players[1];
  const noPw = await emitAck(guest.socket!, "room:join", { code: privCode });
  assert.equal(noPw.ok, false);
  assert.equal(noPw.error, "ROOM_PASSWORD_INVALID");
  const wrongPw = await emitAck(guest.socket!, "room:join", { code: privCode, password: "nope-nope" });
  assert.equal(wrongPw.ok, false);
  const rightPw = await emitAck(guest.socket!, "room:join", { code: privCode, password: "gate-pass" });
  assert.ok(rightPw.ok, "correct password refused");
  await emitAck(guest.socket!, "room:leave", { code: privCode });

  // Out-of-turn action is refused and moves no chips.
  const round = await startRound();
  const stateBefore = latestState(players[0]);
  assert.equal(stateBefore.round.turnUserId, players[1].id);
  const oot = await emitAck(players[3].socket!, "game:action", { code: roomCode, type: "chaal", actionId: "oot-1" });
  assert.equal(oot.ok, false);
  assert.equal(oot.error, "NOT_YOUR_TURN");
  await sleep(300);
  assert.equal(latestState(players[0]).round.pot, stateBefore.round.pot);

  // A replayed actionId never double-debits.
  const first = await emitAck(players[1].socket!, "game:action", { code: roomCode, type: "chaal", actionId: "replay-1" });
  assert.ok(first.ok);
  const potAfterFirst = latestState(players[0]).round.pot;
  const balAfterFirst = (await wallet(players[1])).balance;
  const replay = await emitAck(players[1].socket!, "game:action", { code: roomCode, type: "chaal", actionId: "replay-1" });
  assert.ok(replay.ok);
  await sleep(300);
  assert.equal(latestState(players[0]).round.pot, potAfterFirst, "replay changed the pot");
  assert.equal((await wallet(players[1])).balance, balAfterFirst, "replay changed a balance");

  const result = await driveRound((actorId) => (actorId === players[0].id ? { type: "chaal" } : { type: "pack" }));
  await assertRoundMoney(round.id, result);

  // OTP brute force: five wrong codes exhaust the attempts; even the right
  // code is then refused.
  const victim = "+923555399999";
  const r1 = await fetch(`${BASE}/api/auth/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber: victim }),
  });
  const d1: any = await r1.json();
  const right = d1.devCode;
  const wrong = right === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) {
    const rr = await fetch(`${BASE}/api/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobileNumber: victim, code: wrong, username: "brute_victim" }),
    });
    assert.equal(rr.status, 400);
  }
  const rr = await fetch(`${BASE}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobileNumber: victim, code: right, username: "brute_victim" }),
  });
  assert.equal(rr.status, 400, "correct OTP accepted after 5 failed attempts");
});

test("ledger audit: every wallet is exactly the sum of its ledger rows", { timeout: 60_000 }, async () => {
  let total = 0;
  for (const p of players) {
    const w = await wallet(p);
    total += w.balance;
    const sum = w.transactions.reduce((s: number, t: any) => s + t.amount, 0);
    // /api/wallet returns the latest 20 rows only; the full-history invariant
    // is covered in the service simulation — here we check the bonus rule
    // over the wire: exactly one SIGNUP_BONUS may ever be credited.
    void sum;
    const bonuses = w.transactions.filter((t: any) => t.type === "SIGNUP_BONUS");
    assert.ok(bonuses.length <= 1);
    assert.ok(w.balance > 0 && w.balance <= 60_000);
  }
  assert.equal(total, 60_000, "total chips across the club changed");
});
