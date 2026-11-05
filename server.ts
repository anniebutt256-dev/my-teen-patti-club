// Custom server — Next.js + Socket.IO on one HTTP server.
// The game server is authoritative: sockets are authenticated with the same
// session cookie as the web app. Phase 3 wires the full realtime protocol:
//   client -> server: room:create, room:join, room:leave, game:start, game:action
//   server -> client: table:state (public only), hand:private (own socket only),
//                     turn:changed, pot:updated, round:result, wallet:updated,
//                     room:players, error
// A player's cards are emitted only to that player's own user channel —
// never to the room channel.

import { createServer } from "node:http";
import next from "next";
import { Server as SocketServer, type Socket } from "socket.io";
import { verifySession } from "./src/server/session";
import { getServices } from "./src/server/services";
import type { RoomRecord } from "./src/server/rooms";
import type { GameActionType } from "./src/server/game";

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";

const app = next({ dev });
const handle = app.getRequestHandler();

function sessionFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "mtpc_session") return verifySession(rest.join("="));
  }
  return null;
}

type Ack = (res: Record<string, unknown>) => void;

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new SocketServer(httpServer, { cors: { origin: false } });
  const { store, rooms, game, wallet } = getServices();

  const channel = (room: RoomRecord) => `room:${room.id}`;

  // Disconnect grace (Phase 6): a player who drops mid-round keeps their
  // seat and hand for GRACE_MS; reconnecting inside the window restores
  // them exactly where they were. If the window expires with no live
  // socket for the user, the server packs their hand for that round
  // (their seat at the table is kept for the next round).
  const GRACE_MS = Number(process.env.RECONNECT_GRACE_MS ?? 30_000);
  const graceTimers = new Map<string, NodeJS.Timeout>();
  const graceKey = (userId: string, roomId: string) => `${userId}:${roomId}`;
  function clearGrace(userId: string, roomId: string) {
    const key = graceKey(userId, roomId);
    const t = graceTimers.get(key);
    if (t) {
      clearTimeout(t);
      graceTimers.delete(key);
    }
  }

  async function emitState(room: RoomRecord) {
    const state = await game.publicState(room);
    io.to(channel(room)).emit("table:state", state);
    io.to(channel(room)).emit("room:players", state.room.players);
    return state;
  }

  function emitHands(room: RoomRecord) {
    const round = game.activeRound(room.id);
    if (!round) return;
    for (const p of round.players) {
      const hand = game.privateHand(p.userId, room.id);
      if (hand) {
        io.to(`user:${p.userId}`).emit("hand:private", {
          roomCode: room.code,
          cards: hand.cards,
          seen: hand.seen,
        });
      }
    }
  }

  async function emitWallets(room: RoomRecord) {
    for (const seat of room.seats) {
      io.to(`user:${seat.userId}`).emit("wallet:updated", {
        balance: await wallet.getBalance(seat.userId),
      });
    }
  }

  function emitTurnAndPot(room: RoomRecord) {
    const round = game.activeRound(room.id);
    if (!round) return;
    io.to(channel(room)).emit("turn:changed", { turnUserId: round.turnUserId });
    io.to(channel(room)).emit("pot:updated", {
      pot: round.pot,
      currentStake: round.currentStake,
    });
  }

  io.use(async (socket, nextFn) => {
    const userId = sessionFromCookie(socket.handshake.headers.cookie);
    if (!userId) return nextFn(new Error("UNAUTHORIZED"));
    // A valid token is not enough: suspended accounts are refused here too,
    // so an admin suspension takes effect on live play immediately.
    const user = await store.findUserById(userId);
    if (!user || user.status === "SUSPENDED") {
      return nextFn(new Error("UNAUTHORIZED"));
    }
    socket.data.userId = userId;
    nextFn();
  });

  io.on("connection", async (socket: Socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);
    socket.emit("connected", { userId });

    // Reconnect restore: rejoin every room the user is seated in and hand
    // back their own cards (and only theirs) for any live round.
    for (const room of rooms.roomsOfUser(userId)) {
      clearGrace(userId, room.id);
      socket.join(channel(room));
      socket.emit("table:state", await game.publicState(room));
      const hand = game.privateHand(userId, room.id);
      if (hand) {
        socket.emit("hand:private", {
          roomCode: room.code,
          cards: hand.cards,
          seen: hand.seen,
        });
      }
    }

    const fail = (ack: Ack | undefined, e: unknown) => {
      const msg = e instanceof Error ? e.message : "ERROR";
      socket.emit("error", { code: msg });
      if (ack) ack({ ok: false, error: msg });
    };

    socket.on("room:create", async (payload: Record<string, unknown>, ack?: Ack) => {
      try {
        const user = await store.findUserById(userId);
        if (!user) throw new Error("UNAUTHORIZED");
        const room = await rooms.createRoom(user, {
          name: payload?.name ? String(payload.name) : undefined,
          type: payload?.type === "PRIVATE" ? "PRIVATE" : "PUBLIC",
          password: payload?.password ? String(payload.password) : undefined,
          bootAmount:
            payload?.bootAmount !== undefined ? Number(payload.bootAmount) : undefined,
        });
        socket.join(channel(room));
        const state = await emitState(room);
        if (ack) ack({ ok: true, room: state.room });
      } catch (e) {
        fail(ack, e);
      }
    });

    socket.on("room:join", async (payload: Record<string, unknown>, ack?: Ack) => {
      try {
        const user = await store.findUserById(userId);
        if (!user) throw new Error("UNAUTHORIZED");
        const { room } = await rooms.joinRoom(
          user,
          String(payload?.code ?? ""),
          payload?.password ? String(payload.password) : undefined,
        );
        socket.join(channel(room));
        const state = await emitState(room);
        const hand = game.privateHand(userId, room.id);
        if (hand) {
          socket.emit("hand:private", {
            roomCode: room.code,
            cards: hand.cards,
            seen: hand.seen,
          });
        }
        if (ack) ack({ ok: true, room: state.room });
      } catch (e) {
        fail(ack, e);
      }
    });

    socket.on("room:leave", async (payload: Record<string, unknown>, ack?: Ack) => {
      try {
        const room = rooms.getByCode(String(payload?.code ?? ""));
        if (!room) throw new Error("ROOM_NOT_FOUND");
        await game.handlePlayerLeft(userId, room);
        const after = rooms.leaveRoom(userId, room.id);
        socket.leave(channel(room));
        if (after) {
          await emitState(after);
          emitTurnAndPot(after);
          await emitWallets(after);
          const round = game.activeRound(after.id);
          if (!round && game.getLastResult(after.id)) {
            io.to(channel(after)).emit("round:result", game.getLastResult(after.id));
          }
        }
        if (ack) ack({ ok: true });
      } catch (e) {
        fail(ack, e);
      }
    });

    socket.on("disconnect", () => {
      for (const room of rooms.roomsOfUser(userId)) {
        const round = game.activeRound(room.id);
        const inRound = round?.players.some((p) => p.userId === userId && !p.packed);
        if (!round || !inRound) continue;
        clearGrace(userId, room.id);
        const timer = setTimeout(async () => {
          graceTimers.delete(graceKey(userId, room.id));
          const live = await io.in(`user:${userId}`).fetchSockets();
          if (live.length > 0) return; // reconnected on another socket
          const current = rooms.getById(room.id);
          if (!current) return;
          await game.handlePlayerLeft(userId, current);
          await emitState(current);
          emitTurnAndPot(current);
          await emitWallets(current);
          if (!game.activeRound(current.id) && game.getLastResult(current.id)) {
            io.to(channel(current)).emit("round:result", game.getLastResult(current.id));
          }
        }, GRACE_MS);
        graceTimers.set(graceKey(userId, room.id), timer);
      }
    });

    socket.on("game:start", async (payload: Record<string, unknown>, ack?: Ack) => {
      try {
        const room = rooms.getByCode(String(payload?.code ?? ""));
        if (!room) throw new Error("ROOM_NOT_FOUND");
        const round = await game.startRound(userId, room);
        await emitState(room);
        emitHands(room);
        emitTurnAndPot(room);
        await emitWallets(room);
        if (ack) ack({ ok: true, roundId: round.id });
      } catch (e) {
        fail(ack, e);
      }
    });

    socket.on("game:action", async (payload: Record<string, unknown>, ack?: Ack) => {
      try {
        const room = rooms.getByCode(String(payload?.code ?? ""));
        if (!room) throw new Error("ROOM_NOT_FOUND");
        const type = String(payload?.type ?? "") as GameActionType;
        const round = await game.act(userId, room, {
          type,
          raise: payload?.raise === true,
          actionId: payload?.actionId ? String(payload.actionId) : undefined,
        });
        await emitState(room);
        emitTurnAndPot(room);
        await emitWallets(room);
        // Refresh the actor's private hand view (seen flag may have changed).
        const hand = game.privateHand(userId, room.id);
        if (hand) {
          socket.emit("hand:private", {
            roomCode: room.code,
            cards: hand.cards,
            seen: hand.seen,
          });
        }
        if (round.status === "SETTLED" && round.result) {
          io.to(channel(room)).emit("round:result", round.result);
        }
        if (ack) ack({ ok: true });
      } catch (e) {
        fail(ack, e);
      }
    });
  });

  httpServer.listen(port, () => {
    console.log(`MY TEEN PATTI CLUB listening on http://localhost:${port}`);
  });
});
