export default function HomePage() {
  return (
    <main>
      <div className="card" style={{ textAlign: "center" }}>
        <h1 className="club-title">MY TEEN PATTI CLUB</h1>
        <p>Classic Teen Patti with friends — on every phone.</p>
        <p>Virtual chips only. No real-money play.</p>
        <a href="/login">
          <button type="button">Login / Register with mobile OTP</button>
        </a>
        <p>
          <a href="/lobby">Go to the lobby — create or join a room</a>
        </p>
        <p>
          <a href="/wallet">My wallet</a> · <a href="/profile">My profile</a> ·{" "}
          <a href="/admin">Admin</a>
        </p>
      </div>
    </main>
  );
}
