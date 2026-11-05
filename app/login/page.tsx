"use client";
import { useState } from "react";

export default function LoginPage() {
  const [mobile, setMobile] = useState("+92");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [step, setStep] = useState<"mobile" | "code">("mobile");
  const [msg, setMsg] = useState("");
  const [devCode, setDevCode] = useState("");
  const [pwUsername, setPwUsername] = useState("");
  const [pwPassword, setPwPassword] = useState("");
  const [pwMsg, setPwMsg] = useState("");

  async function requestOtp() {
    setMsg("");
    const r = await fetch("/api/auth/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobileNumber: mobile }),
    });
    const data = await r.json();
    if (!r.ok) return setMsg(data.error ?? "Failed to send OTP");
    if (data.devCode) setDevCode(data.devCode);
    setStep("code");
    setMsg("OTP sent. It expires in 5 minutes.");
  }

  async function verify() {
    setMsg("");
    const r = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobileNumber: mobile, code, username }),
    });
    const data = await r.json();
    if (!r.ok) return setMsg(data.error ?? "Verification failed");
    setMsg(
      data.isNewUser
        ? `Welcome, ${data.user.username}! 10,000 free chips added to your wallet.`
        : `Welcome back, ${data.user.username}!`,
    );
    setTimeout(() => (window.location.href = "/wallet"), 900);
  }

  return (
    <main>
      <div className="card">
        <h1 className="club-title">Login / Register</h1>
        {step === "mobile" ? (
          <>
            <label>
              Mobile number (with country code)
              <input
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                inputMode="tel"
                placeholder="+92xxxxxxxxxx"
              />
            </label>
            <button type="button" onClick={requestOtp}>
              Send OTP
            </button>
          </>
        ) : (
          <>
            <label>
              OTP code
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                placeholder="6-digit code"
              />
            </label>
            <label>
              Username (only for new accounts)
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="unique username"
              />
            </label>
            <button type="button" onClick={verify}>
              Verify &amp; continue
            </button>
            {devCode && (
              <p style={{ opacity: 0.8 }}>
                Dev mode (no SMS provider yet): your code is {devCode}
              </p>
            )}
          </>
        )}
        {msg && <p>{msg}</p>}
      </div>

      <div className="card">
        <h2 className="club-title">Invited by the club owner?</h2>
        <p style={{ opacity: 0.85 }}>
          If the owner made your account for you, sign in with the username
          and password they gave you — no OTP needed.
        </p>
        <label>
          Username
          <input
            value={pwUsername}
            onChange={(e) => setPwUsername(e.target.value)}
            placeholder="your username"
            autoComplete="username"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={pwPassword}
            onChange={(e) => setPwPassword(e.target.value)}
            placeholder="your password"
            autoComplete="current-password"
          />
        </label>
        <button
          type="button"
          onClick={async () => {
            setPwMsg("");
            const r = await fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username: pwUsername, password: pwPassword }),
            });
            const data = await r.json();
            if (!r.ok) return setPwMsg(data.error ?? "Login failed");
            setPwMsg(`Welcome, ${data.user.username}!`);
            setTimeout(() => (window.location.href = "/lobby"), 700);
          }}
        >
          Sign in
        </button>
        {pwMsg && <p>{pwMsg}</p>}
      </div>
    </main>
  );
}
