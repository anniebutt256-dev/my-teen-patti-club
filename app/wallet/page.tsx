"use client";
import { useEffect, useState } from "react";

interface Tx {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  note: string | null;
  createdAt: number;
}

const TYPE_LABELS: Record<string, string> = {
  SIGNUP_BONUS: "Welcome bonus",
  BOOT: "Boot",
  CHAAL: "Chaal / Show",
  POT_WIN: "Pot won 🏆",
  REFUND: "Refund",
  ADMIN_GRANT: "Admin grant",
  ADMIN_DEDUCT: "Admin deduction",
};

export default function WalletPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/wallet")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed");
        setBalance(data.balance);
        setTxs(data.transactions);
      })
      .catch((e) => setErr(e.message));
  }, []);

  return (
    <main>
      <div className="card" style={{ maxWidth: 520 }}>
        <h1 className="club-title">My Wallet</h1>
        {err ? (
          <p>
            {err} — <a href="/login">login first</a>
          </p>
        ) : balance === null ? (
          <p>Loading…</p>
        ) : (
          <>
            <p style={{ fontSize: 30, textAlign: "center", margin: "8px 0" }}>
              🪙 {balance.toLocaleString()} <small style={{ fontSize: 14 }}>virtual chips</small>
            </p>
            <p style={{ textAlign: "center", opacity: 0.85, fontSize: 13 }}>
              Virtual chips only — no real money, no deposits or withdrawals.
            </p>
            <h3>Transaction history</h3>
            {txs.length === 0 ? (
              <p>No transactions yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0 }}>
                {txs.map((t) => (
                  <li
                    key={t.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "8px 0",
                      borderBottom: "1px solid rgba(212,175,55,.25)",
                    }}
                  >
                    <span>
                      {TYPE_LABELS[t.type] ?? t.type}
                      {t.note ? <small style={{ display: "block", opacity: 0.75 }}>{t.note}</small> : null}
                      <small style={{ display: "block", opacity: 0.6 }}>
                        {new Date(t.createdAt).toLocaleString()}
                      </small>
                    </span>
                    <span style={{ color: t.amount >= 0 ? "#8dff9a" : "#ffb3b3", fontWeight: 700 }}>
                      {t.amount > 0 ? "+" : ""}
                      {t.amount.toLocaleString()}
                      <small style={{ display: "block", color: "#fff", opacity: 0.7, fontWeight: 400 }}>
                        bal {t.balanceAfter.toLocaleString()}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p style={{ marginTop: 16 }}>
              <a href="/lobby">Lobby</a> · <a href="/profile">Profile</a>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
