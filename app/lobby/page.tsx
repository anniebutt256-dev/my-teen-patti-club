"use client";
import { useCallback, useEffect, useState } from "react";

interface RoomView {
  code: string;
  name: string;
  type: "PUBLIC" | "PRIVATE";
  bootAmount: number;
  status: string;
  playerCount: number;
  maxPlayers: number;
  whatsappUrl?: string;
  players?: { username: string; seatNo: number; isHost: boolean }[];
}

export default function LobbyPage() {
  const [rooms, setRooms] = useState<RoomView[]>([]);
  const [current, setCurrent] = useState<RoomView | null>(null);
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState("");
  const [boot, setBoot] = useState("10");
  const [joinCode, setJoinCode] = useState("");
  const [joinPassword, setJoinPassword] = useState("");

  const loadRooms = useCallback(async () => {
    const r = await fetch("/api/rooms");
    if (r.status === 401) {
      window.location.href = "/login";
      return;
    }
    const data = await r.json();
    setRooms(data.rooms ?? []);
  }, []);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  async function createRoom() {
    setMsg("");
    const r = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || undefined,
        type: isPrivate ? "PRIVATE" : "PUBLIC",
        password: isPrivate ? password : undefined,
        bootAmount: Number(boot) || 10,
      }),
    });
    const data = await r.json();
    if (!r.ok) return setMsg(data.error ?? "Could not create room");
    setCurrent(data.room);
    setMsg(`Room created — share the code ${data.room.code} with your friends.`);
    loadRooms();
  }

  async function joinRoom(code: string, pw?: string) {
    setMsg("");
    const r = await fetch(`/api/rooms/${encodeURIComponent(code)}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw || undefined }),
    });
    const data = await r.json();
    if (!r.ok) return setMsg(data.error ?? "Could not join room");
    setCurrent(data.room);
    setMsg(`You are seated at room ${data.room.code}.`);
    loadRooms();
  }

  async function leaveRoom() {
    if (!current) return;
    await fetch(`/api/rooms/${encodeURIComponent(current.code)}/leave`, {
      method: "POST",
    });
    setCurrent(null);
    setMsg("You left the room.");
    loadRooms();
  }

  return (
    <main>
      <div className="card" style={{ maxWidth: 520 }}>
        <h1 className="club-title">Lobby</h1>

        <h3>Create a room</h3>
        <label>
          Room name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Friends table" />
        </label>
        <label>
          Boot amount (chips)
          <input value={boot} onChange={(e) => setBoot(e.target.value)} inputMode="numeric" />
        </label>
        <label style={{ display: "block", marginTop: 10 }}>
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            style={{ width: "auto", marginRight: 8 }}
          />
          Private room (password protected)
        </label>
        {isPrivate && (
          <label>
            Room password
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 4 characters" />
          </label>
        )}
        <button type="button" onClick={createRoom}>
          Create room
        </button>

        <h3 style={{ marginTop: 28 }}>Join with a code</h3>
        <label>
          Room code
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="e.g. K7PX2A" />
        </label>
        <label>
          Password (private rooms only)
          <input value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} />
        </label>
        <button type="button" onClick={() => joinRoom(joinCode, joinPassword)}>
          Join room
        </button>

        <h3 style={{ marginTop: 28 }}>Public rooms</h3>
        {rooms.length === 0 && <p style={{ opacity: 0.8 }}>No public rooms yet — create one above.</p>}
        {rooms.map((room) => (
          <p key={room.code}>
            <strong>{room.name}</strong> — code {room.code}, boot {room.bootAmount},{" "}
            {room.playerCount}/{room.maxPlayers} players, {room.status}{" "}
            <button
              type="button"
              style={{ width: "auto", padding: "6px 12px", marginLeft: 8 }}
              onClick={() => joinRoom(room.code)}
            >
              Join
            </button>
          </p>
        ))}

        {current && (
          <div style={{ marginTop: 28, borderTop: "1px solid rgba(212,175,55,.4)", paddingTop: 16 }}>
            <h3>
              Your room: {current.name} ({current.code})
            </h3>
            <p>
              Boot {current.bootAmount} · {current.playerCount}/{current.maxPlayers} players ·{" "}
              {current.status}
            </p>
            {current.players && (
              <p>
                Seated:{" "}
                {current.players
                  .map((p) => `${p.username}${p.isHost ? " (host)" : ""}`)
                  .join(", ")}
              </p>
            )}
            {current.whatsappUrl && (
              <p>
                <a href={current.whatsappUrl} target="_blank" rel="noreferrer">
                  Invite friends on WhatsApp
                </a>
              </p>
            )}
            <a href={`/room/${current.code}`}>
              <button type="button">Open the table</button>
            </a>
            <button type="button" onClick={leaveRoom}>
              Leave room
            </button>
            <p style={{ opacity: 0.8 }}>
              The host can start the game from the table screen once at least
              2 players are seated.
            </p>
          </div>
        )}

        {msg && <p>{msg}</p>}
        <p>
          <a href="/wallet">My wallet</a>
        </p>
      </div>
    </main>
  );
}
