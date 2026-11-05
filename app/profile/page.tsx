"use client";
import { useEffect, useState } from "react";

interface Me {
  id: string;
  username: string;
  displayName: string;
  mobileNumber: string;
  role: string;
}

export default function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed");
        setMe(data.user);
        setDisplayName(data.user.displayName);
        setBalance(data.balance);
      })
      .catch((e) => setErr(e.message));
  }, []);

  async function save() {
    setMsg("");
    const r = await fetch("/api/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName }),
    });
    const data = await r.json();
    if (!r.ok) return setMsg(data.error ?? "Could not save");
    setMe(data.user);
    setMsg("Profile saved.");
  }

  return (
    <main>
      <div className="card">
        <h1 className="club-title">My Profile</h1>
        {err ? (
          <p>
            {err} — <a href="/login">login first</a>
          </p>
        ) : !me ? (
          <p>Loading…</p>
        ) : (
          <>
            <p>
              <strong>Username:</strong> {me.username}
            </p>
            <p>
              <strong>Mobile:</strong> {me.mobileNumber} (verified)
            </p>
            <p>
              <strong>Balance:</strong> 🪙 {balance?.toLocaleString()} virtual chips
            </p>
            <label>
              Display name
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
            <button type="button" onClick={save}>
              Save profile
            </button>
            {msg && <p>{msg}</p>}
            <p style={{ marginTop: 16 }}>
              <a href="/lobby">Lobby</a> · <a href="/wallet">Wallet</a>
            </p>
            <p style={{ opacity: 0.8, fontSize: 13 }}>
              On iPhone: open this page in Safari, tap Share, then
              “Add to Home Screen” to install the club app. On Android/Chrome
              use “Install app” from the browser menu.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
