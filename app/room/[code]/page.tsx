"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import type { Card } from "../../../src/game/engine";
import {
  SLOT_POSITIONS,
  avatarInitials,
  availableActions,
  relativeSlot,
} from "../../../src/client/table-ui";
import PlayingCard from "../../../src/components/PlayingCard";

interface RoomPlayerView {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  seatNo: number;
  isHost: boolean;
}
interface RoomView {
  code: string;
  name: string;
  type: "PUBLIC" | "PRIVATE";
  bootAmount: number;
  status: string;
  ownerId: string;
  playerCount: number;
  maxPlayers: number;
  players: RoomPlayerView[];
  whatsappUrl: string;
}
interface RoundPlayer {
  userId: string;
  seatNo: number;
  seen: boolean;
  packed: boolean;
  totalBet: number;
}
interface RoundResult {
  winnerUserId: string;
  potWon: number;
  winningHand: string;
  revealed: { userId: string; cards: Card[]; category: string }[];
}
interface TableState {
  room: RoomView;
  round: {
    id: string;
    roundNo: number;
    status: string;
    pot: number;
    currentStake: number;
    turnUserId: string | null;
    players: RoundPlayer[];
    result: RoundResult | null;
  } | null;
  lastResult: RoundResult | null;
  balances: Record<string, number>;
}

export default function TablePage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();
  const router = useRouter();

  const [me, setMe] = useState<{ id: string; username: string } | null>(null);
  const [state, setState] = useState<TableState | null>(null);
  const [myHand, setMyHand] = useState<{ cards: Card[]; seen: boolean } | null>(null);
  const [myBalance, setMyBalance] = useState<number | null>(null);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [reportTarget, setReportTarget] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [reportMsg, setReportMsg] = useState("");
  const [notFound, setNotFound] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const actionSeq = useRef(0);
  const lastRoundId = useRef<string | null>(null);

  const loadState = useCallback(async () => {
    const r = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
    if (r.status === 401) {
      router.push("/login");
      return;
    }
    const data = await r.json();
    if (!r.ok) {
      setNotFound(true);
      setMsg(data.error ?? "Room not found");
      return;
    }
    if (data.room?.requiresPassword) {
      setNeedPassword(true);
      return;
    }
    setNeedPassword(false);
    setState(data as TableState);
    if (data.myHand) setMyHand(data.myHand);
  }, [code, router]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (r) => {
        if (!r.ok) {
          router.push("/login");
          return;
        }
        const data = await r.json();
        setMe({ id: data.user.id, username: data.user.username });
        setMyBalance(data.balance);
      })
      .catch(() => {});
    loadState();
  }, [loadState, router]);

  useEffect(() => {
    if (!me || needPassword) return;
    const socket = io({ withCredentials: true });
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("room:join", { code }, () => {});
    });
    socket.on("table:state", (s: TableState) => {
      if (s.room.code === code) setState(s);
    });
    socket.on("hand:private", (h: { roomCode: string; cards: Card[]; seen: boolean }) => {
      if (h.roomCode === code) setMyHand({ cards: h.cards, seen: h.seen });
    });
    socket.on("round:result", (res: RoundResult) => setResult(res));
    socket.on("wallet:updated", (w: { balance: number }) => setMyBalance(w.balance));
    socket.on("error", (e: { code: string }) => setMsg(e.code));
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [me, code, needPassword]);

  // Clear the result banner and stale hand when a fresh round begins.
  useEffect(() => {
    const roundId = state?.round?.id ?? null;
    if (roundId && roundId !== lastRoundId.current) {
      lastRoundId.current = roundId;
      setResult(null);
    }
    if (!roundId) setMyHand(null);
  }, [state?.round?.id]);

  const room = state?.room ?? null;
  const round = state?.round ?? null;
  const mySeat = room?.players.find((p) => p.userId === me?.id) ?? null;
  const myRound = round?.players.find((p) => p.userId === me?.id) ?? null;
  const isHost = !!me && room?.ownerId === me.id;

  const activePlayers = useMemo(
    () =>
      (round?.players ?? [])
        .filter((p) => !p.packed)
        .sort((a, b) => a.seatNo - b.seatNo),
    [round],
  );
  const previousSeen = useMemo(() => {
    if (!myRound || activePlayers.length === 0) return false;
    const idx = activePlayers.findIndex((p) => p.userId === me?.id);
    if (idx === -1) return false;
    const prev = activePlayers[(idx - 1 + activePlayers.length) % activePlayers.length];
    return prev.seen;
  }, [activePlayers, myRound, me]);

  const actions = availableActions({
    roundActive: !!round && round.status === "BETTING",
    isMyTurn: !!me && round?.turnUserId === me.id,
    myPacked: !!myRound?.packed,
    mySeen: !!myRound?.seen,
    activePlayers: activePlayers.length,
    previousSeen,
  });

  const nameOf = (userId: string) =>
    room?.players.find((p) => p.userId === userId)?.username ?? "Player";

  function emitAction(type: string, raise = false) {
    const socket = socketRef.current;
    if (!socket) return;
    setMsg("");
    actionSeq.current += 1;
    socket.emit(
      "game:action",
      { code, type, raise, actionId: `ui-${Date.now()}-${actionSeq.current}` },
      (res: { ok: boolean; error?: string }) => {
        if (!res?.ok) setMsg(res?.error ?? "Action failed");
      },
    );
  }

  function startGame() {
    const socket = socketRef.current;
    if (!socket) return;
    setMsg("");
    socket.emit("game:start", { code }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setMsg(res?.error ?? "Could not start");
    });
  }

  async function leave() {
    const socket = socketRef.current;
    if (socket) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 1200);
        socket.emit("room:leave", { code }, () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    router.push("/lobby");
  }

  async function submitReport() {
    setReportMsg("");
    const r = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetId: reportTarget || undefined,
        roomCode: code,
        reason: reportReason,
      }),
    });
    const data = await r.json();
    if (!r.ok) return setReportMsg(data.error ?? "Could not file report");
    setReportReason("");
    setReportMsg("Report sent to the admins. Thank you.");
  }

  async function joinWithPassword() {
    setMsg("");
    const r = await fetch(`/api/rooms/${encodeURIComponent(code)}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await r.json();
    if (!r.ok) return setMsg(data.error ?? "Could not join");
    await loadState();
  }

  if (notFound) {
    return (
      <main>
        <div className="card">
          <h1 className="club-title">Room not found</h1>
          <p>{msg}</p>
          <p>
            <a href="/lobby">Back to the lobby</a>
          </p>
        </div>
      </main>
    );
  }

  if (needPassword) {
    return (
      <main>
        <div className="card">
          <h1 className="club-title">Private room {code}</h1>
          <p>This room needs a password to take a seat.</p>
          <label>
            Room password
            <input value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="button" onClick={joinWithPassword}>
            Join room
          </button>
          {msg && <p>{msg}</p>}
          <p>
            <a href="/lobby">Back to the lobby</a>
          </p>
        </div>
      </main>
    );
  }

  if (!room || !me) {
    return (
      <main>
        <div className="card">
          <p>Loading table…</p>
        </div>
      </main>
    );
  }

  const shownResult = result ?? (!round ? state?.lastResult ?? null : null);
  const myChaalAmount = round
    ? round.currentStake * (myRound?.seen ? 2 : 1)
    : 0;
  const turnName = round?.turnUserId
    ? round.turnUserId === me.id
      ? "Your turn!"
      : `${nameOf(round.turnUserId)}'s turn`
    : null;

  return (
    <main className="table-main">
      <div className="table-topbar">
        <div>
          <strong className="club-title">{room.name}</strong>{" "}
          <span style={{ opacity: 0.85 }}>
            · Code {room.code} · Boot {room.bootAmount}
          </span>
        </div>
        <div className="table-topbar-actions">
          <span className="balance-chip">
            🪙 {myBalance !== null ? myBalance.toLocaleString() : "…"}
          </span>
          <a href={room.whatsappUrl} target="_blank" rel="noreferrer">
            WhatsApp invite
          </a>
          <button type="button" className="small-btn" onClick={leave}>
            Leave
          </button>
        </div>
      </div>

      <div className="felt">
        <div className="pot-display">
          {round ? (
            <>
              <div className="pot-amount">🪙 {round.pot}</div>
              <div className="pot-label">
                Pot · Stake {round.currentStake}
                {round.currentStake * 2 <= room.bootAmount * 32 ? "" : " (max)"}
              </div>
              <div className="turn-label">{turnName}</div>
            </>
          ) : (
            <>
              <div className="pot-amount">MY TEEN PATTI CLUB</div>
              <div className="pot-label">
                {room.playerCount < 2
                  ? "Waiting for players — share the invite link"
                  : isHost
                    ? "Ready — start the game when everyone is seated"
                    : "Waiting for the host to start"}
              </div>
            </>
          )}
        </div>

        {[0, 1, 2, 3, 4, 5].map((seatNo) => {
          const player = room.players.find((p) => p.seatNo === seatNo);
          const slot = mySeat ? relativeSlot(mySeat.seatNo, seatNo) : seatNo;
          const pos = SLOT_POSITIONS[slot];
          if (!player) {
            return (
              <div key={seatNo} className="seat seat-empty" style={{ ...pos }}>
                Empty seat
              </div>
            );
          }
          const rp = round?.players.find((p) => p.userId === player.userId);
          const isTurn = round?.turnUserId === player.userId;
          const isMe = player.userId === me.id;
          return (
            <div
              key={seatNo}
              className={`seat${isTurn ? " seat-turn" : ""}${rp?.packed ? " seat-packed" : ""}`}
              style={{ ...pos }}
            >
              <div className="seat-avatar">{avatarInitials(player.displayName)}</div>
              <div className="seat-name">
                {player.username}
                {player.isHost ? " 👑" : ""}
                {isMe ? " (you)" : ""}
              </div>
              <div className="seat-balance">
                🪙 {(state?.balances[player.userId] ?? 0).toLocaleString()}
              </div>
              {rp && (
                <div className="seat-cards">
                  {isMe && myHand && rp.seen
                    ? myHand.cards.map((c, i) => (
                        <PlayingCard key={i} card={c} small delayMs={i * 120} />
                      ))
                    : [0, 1, 2].map((i) => (
                        <PlayingCard key={i} faceDown small delayMs={i * 120} />
                      ))}
                </div>
              )}
              {rp && (
                <div className="seat-badges">
                  {rp.packed ? (
                    <span className="badge badge-packed">Packed</span>
                  ) : (
                    <span className={rp.seen ? "badge badge-seen" : "badge"}>
                      {rp.seen ? "👁 Seen" : "Blind"}
                    </span>
                  )}
                  {rp.totalBet > 0 && <span className="badge">Bet {rp.totalBet}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {myHand && round && myRound && (
        <div className="my-hand">
          <span style={{ marginRight: 8 }}>Your cards{myRound.seen ? "" : " (blind)"}:</span>
          {myHand.cards.map((c, i) => (
            <PlayingCard key={i} card={myRound.seen ? c : null} faceDown={!myRound.seen} delayMs={i * 120} />
          ))}
        </div>
      )}

      {shownResult && (
        <div className="result-banner">
          🏆 {nameOf(shownResult.winnerUserId)} won 🪙 {shownResult.potWon} —{" "}
          {shownResult.winningHand.replaceAll("_", " ")}
          {shownResult.revealed.map((r) => (
            <div key={r.userId} className="reveal-row">
              <span>
                {nameOf(r.userId)} ({r.category.replaceAll("_", " ")}):
              </span>
              {r.cards.map((c, i) => (
                <PlayingCard key={i} card={c} small />
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="action-bar">
        {!round && isHost && room.playerCount >= 2 && (
          <button type="button" onClick={startGame}>
            Start game
          </button>
        )}
        {!round && !isHost && <span style={{ opacity: 0.85 }}>Waiting for the host to start…</span>}
        {round && !myRound && <span style={{ opacity: 0.85 }}>You are watching this round — you will be dealt in next round.</span>}
        {round && myRound?.packed && <span style={{ opacity: 0.85 }}>You packed this round.</span>}
        {round && myRound && !myRound.packed && (
          <>
            <button type="button" disabled={!actions.seen} onClick={() => emitAction("seen")}>
              See cards
            </button>
            <button type="button" disabled={!actions.chaal} onClick={() => emitAction("chaal")}>
              Chaal 🪙{myChaalAmount}
            </button>
            <button
              type="button"
              disabled={!actions.chaal}
              onClick={() => emitAction("chaal", true)}
            >
              Raise 🪙{myChaalAmount * 2}
            </button>
            <button type="button" disabled={!actions.sideshow} onClick={() => emitAction("sideshow")}>
              Side Show
            </button>
            <button type="button" disabled={!actions.show} onClick={() => emitAction("show")}>
              Show
            </button>
            <button type="button" disabled={!actions.pack} onClick={() => emitAction("pack")}>
              Pack
            </button>
          </>
        )}
      </div>
      {msg && <p className="table-msg">{msg}</p>}
      <div className="action-bar" style={{ alignItems: "center" }}>
        <span style={{ fontWeight: 700 }}>Report a player:</span>
        <select
          value={reportTarget}
          onChange={(e) => setReportTarget(e.target.value)}
          style={{ padding: 10, borderRadius: 10, flex: "1 1 120px" }}
        >
          <option value="">Select player</option>
          {room.players
            .filter((p) => p.userId !== me.id)
            .map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.username}
              </option>
            ))}
        </select>
        <input
          value={reportReason}
          onChange={(e) => setReportReason(e.target.value)}
          placeholder="What happened?"
          style={{ flex: "2 1 160px", marginTop: 0 }}
        />
        <button
          type="button"
          style={{ flex: "0 1 110px" }}
          disabled={!reportTarget || reportReason.trim().length < 3}
          onClick={submitReport}
        >
          Report
        </button>
        {reportMsg && <span style={{ width: "100%" }}>{reportMsg}</span>}
      </div>
      <p className="table-foot">
        Virtual chips only — no real-money play. <a href="/wallet">Wallet</a> ·{" "}
        <a href="/profile">Profile</a> · <a href="/lobby">Lobby</a>
      </p>
    </main>
  );
}
