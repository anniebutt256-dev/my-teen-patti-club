"use client";
import { useCallback, useEffect, useState } from "react";

interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  mobileNumber: string;
  role: string;
  status: string;
  hasPassword: boolean;
  balance: number;
}
interface AdminRoom {
  code: string;
  name: string;
  type: string;
  status: string;
  bootAmount: number;
  playerCount: number;
  maxPlayers: number;
}
interface Report {
  id: string;
  reporterUsername: string;
  targetUsername: string | null;
  reason: string;
  status: string;
  createdAt: number;
}
interface Audit {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  meta: string | null;
  createdAt: number;
}
interface Overview {
  userCount: number;
  suspendedCount: number;
  liveRoomCount: number;
  openReports: number;
  chipsInCirculation: number;
}

export default function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("100");
  const [roomReason, setRoomReason] = useState("");
  const [msg, setMsg] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetPw, setResetPw] = useState<Record<string, string>>({});

  const load = useCallback(async (q = "") => {
    const [ov, us, rm, rp, au] = await Promise.all([
      fetch("/api/admin/overview").then((r) => r.json()),
      fetch(`/api/admin/users?q=${encodeURIComponent(q)}`).then((r) => r.json()),
      fetch("/api/admin/rooms").then((r) => r.json()),
      fetch("/api/admin/reports").then((r) => r.json()),
      fetch("/api/admin/audit").then((r) => r.json()),
    ]);
    setOverview(ov);
    setUsers(us.users ?? []);
    setRooms(rm.rooms ?? []);
    setReports(rp.reports ?? []);
    setAudit(au.audit ?? []);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok || data.user?.role !== "ADMIN") {
          setAllowed(false);
          return;
        }
        setAllowed(true);
        load();
      })
      .catch(() => setAllowed(false));
  }, [load]);

  async function act(url: string, body: Record<string, unknown>, okText: string) {
    setMsg("");
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) return setMsg(data.error ?? "Action failed");
    setMsg(okText);
    load(search);
  }

  if (allowed === null) {
    return (
      <main>
        <div className="card">
          <p>Loading…</p>
        </div>
      </main>
    );
  }
  if (!allowed) {
    return (
      <main>
        <div className="card">
          <h1 className="club-title">Admin</h1>
          <p>This area is for club admins only.</p>
          <p style={{ opacity: 0.85 }}>
            Admin access is granted to the mobile numbers listed in the
            server&apos;s <code>ADMIN_MOBILES</code> setting at login — there is
            no in-app way to become an admin.
          </p>
          <p>
            <a href="/login">Login</a> · <a href="/lobby">Lobby</a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className="card" style={{ maxWidth: 760 }}>
        <h1 className="club-title">Admin Dashboard</h1>
        {overview && (
          <p>
            👥 {overview.userCount} users ({overview.suspendedCount} suspended) · 🎴{" "}
            {overview.liveRoomCount} live rooms · 🚩 {overview.openReports} open reports ·
            🪙 {overview.chipsInCirculation.toLocaleString()} chips in circulation
          </p>
        )}
        {msg && <p>{msg}</p>}

        <h3>Create account for a friend</h3>
        <p style={{ opacity: 0.85 }}>
          A friend messages you → create their account here → give them the
          username + password. They sign in on the login page (no OTP, no SMS
          cost) and start with the same 10,000 free chips.
        </p>
        <label>
          Username (unique, 3–20 letters/numbers/_)
          <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="e.g. ali_racer" />
        </label>
        <label>
          Display name (optional)
          <input value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="e.g. Ali" />
        </label>
        <label>
          Password (min 6 characters — tell the friend, they use it to sign in)
          <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="e.g. tiger123" />
        </label>
        <button
          type="button"
          onClick={async () => {
            const r = await fetch("/api/admin/users", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username: newUsername, password: newPassword, displayName: newDisplayName || undefined }),
            });
            const data = await r.json();
            if (!r.ok) return setMsg(data.error ?? "Create failed");
            setMsg(`Account created: ${data.user.username} with ${data.user.balance.toLocaleString()} chips. Give them the username + password.`);
            setNewUsername("");
            setNewDisplayName("");
            setNewPassword("");
            load(search);
          }}
        >
          Create account (+10,000 chips)
        </button>

        <h3 style={{ marginTop: 28 }}>Users</h3>
        <label>
          Search (username / mobile / name)
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <button type="button" onClick={() => load(search)}>
          Search
        </button>
        <label>
          Reason for user/chip actions (required, goes to the audit log)
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. abusive chat in room" />
        </label>
        <label>
          Chip amount (for grant / deduct)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" />
        </label>
        {users.map((u) => (
          <div key={u.id} style={{ borderBottom: "1px solid rgba(212,175,55,.25)", padding: "10px 0" }}>
            <strong>{u.username}</strong> ({u.displayName}) · {u.mobileNumber} · {u.role} ·{" "}
            {u.status} · 🪙 {u.balance.toLocaleString()}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {u.status === "ACTIVE" ? (
                <button
                  type="button"
                  style={{ width: "auto", padding: "6px 12px", marginTop: 0 }}
                  onClick={() => act(`/api/admin/users/${u.id}/status`, { status: "SUSPENDED", reason }, `${u.username} suspended`)}
                >
                  Suspend
                </button>
              ) : (
                <button
                  type="button"
                  style={{ width: "auto", padding: "6px 12px", marginTop: 0 }}
                  onClick={() => act(`/api/admin/users/${u.id}/status`, { status: "ACTIVE", reason }, `${u.username} reactivated`)}
                >
                  Reactivate
                </button>
              )}
              <button
                type="button"
                style={{ width: "auto", padding: "6px 12px", marginTop: 0 }}
                onClick={() => act(`/api/admin/users/${u.id}/chips`, { mode: "grant", amount: Number(amount), reason }, `Granted ${amount} chips to ${u.username}`)}
              >
                Grant chips
              </button>
              <button
                type="button"
                style={{ width: "auto", padding: "6px 12px", marginTop: 0 }}
                onClick={() => act(`/api/admin/users/${u.id}/chips`, { mode: "deduct", amount: Number(amount), reason }, `Deducted ${amount} chips from ${u.username}`)}
              >
                Deduct chips
              </button>
              <input
                style={{ width: 150, marginTop: 0 }}
                placeholder={u.hasPassword ? "new password" : "set a password"}
                value={resetPw[u.id] ?? ""}
                onChange={(e) => setResetPw({ ...resetPw, [u.id]: e.target.value })}
              />
              <button
                type="button"
                style={{ width: "auto", padding: "6px 12px", marginTop: 0 }}
                onClick={() => act(`/api/admin/users/${u.id}/password`, { password: resetPw[u.id] ?? "", reason }, `Password set for ${u.username} — tell them the new password`)}
              >
                Set password
              </button>
            </div>
          </div>
        ))}

        <h3 style={{ marginTop: 28 }}>Live rooms</h3>
        <label>
          Reason for closing a room (required)
          <input value={roomReason} onChange={(e) => setRoomReason(e.target.value)} placeholder="e.g. reported table" />
        </label>
        {rooms.length === 0 && <p style={{ opacity: 0.8 }}>No live rooms.</p>}
        {rooms.map((r) => (
          <p key={r.code}>
            <strong>{r.name}</strong> ({r.code}) · {r.type} · {r.status} · boot {r.bootAmount} ·{" "}
            {r.playerCount}/{r.maxPlayers} players{" "}
            <button
              type="button"
              style={{ width: "auto", padding: "6px 12px", marginLeft: 8 }}
              onClick={() => act(`/api/admin/rooms/${r.code}/close`, { reason: roomReason }, `Room ${r.code} closed, bets refunded`)}
            >
              Close room
            </button>
          </p>
        ))}

        <h3 style={{ marginTop: 28 }}>Reports</h3>
        {reports.length === 0 && <p style={{ opacity: 0.8 }}>No reports.</p>}
        {reports.map((r) => (
          <div key={r.id} style={{ borderBottom: "1px solid rgba(212,175,55,.25)", padding: "8px 0" }}>
            🚩 <strong>{r.reporterUsername}</strong>
            {r.targetUsername ? <> reported <strong>{r.targetUsername}</strong></> : " filed a report"}:{" "}
            {r.reason} · {r.status} · {new Date(r.createdAt).toLocaleString()}
            {r.status === "OPEN" && (
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button
                  type="button"
                  style={{ width: "auto", padding: "6px 12px", marginTop: 0 }}
                  onClick={() => act(`/api/admin/reports/${r.id}/review`, { status: "REVIEWED" }, "Report marked reviewed")}
                >
                  Mark reviewed
                </button>
                <button
                  type="button"
                  style={{ width: "auto", padding: "6px 12px", marginTop: 0 }}
                  onClick={() => act(`/api/admin/reports/${r.id}/review`, { status: "DISMISSED" }, "Report dismissed")}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        ))}

        <h3 style={{ marginTop: 28 }}>Audit log</h3>
        {audit.length === 0 && <p style={{ opacity: 0.8 }}>No admin actions yet.</p>}
        <ul style={{ fontSize: 13 }}>
          {audit.map((a) => (
            <li key={a.id}>
              {new Date(a.createdAt).toLocaleString()} — {a.action} on {a.targetType}{" "}
              {a.targetId.slice(0, 18)}… {a.reason ? `— ${a.reason}` : ""}
              {a.meta ? ` (${a.meta})` : ""}
            </li>
          ))}
        </ul>
        <p>
          <a href="/lobby">Lobby</a> · <a href="/wallet">Wallet</a>
        </p>
      </div>
    </main>
  );
}
