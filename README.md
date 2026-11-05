# MY TEEN PATTI CLUB

Multiplayer Classic Teen Patti for friends on separate phones. Mobile-first PWA.
**Virtual chips only — no real-money wagering, deposits or withdrawals.**
New verified accounts receive 10,000 free virtual chips once.

## Status (2026-11-03)
- [x] **Phase 1** — Architecture (`ARCHITECTURE.md`), Prisma database schema
  (`prisma/schema.prisma`), and the game-rules core (`src/game/engine.ts`) with
  passing tests (9/9: hand rankings Trail > Pure Sequence > Sequence > Color >
  Pair > High Card, Teen Patti sequence order AKQ > A23 > …, secure shuffle,
  6-player dealing, blind/seen stake maths).
- [x] **Phase 2** — Next.js app scaffold + custom Socket.IO server (`server.ts`,
  session-authenticated sockets), OTP auth service (hashed codes, 5-min expiry,
  attempt cap, rate limits, unique usernames), wallet ledger service (10,000
  signup bonus exactly once, idempotent movements, overdraft protection) and
  `/api/auth/*` + `/api/wallet` routes. Tests: **16/16 pass** (9 Phase 1 + 7
  Phase 2). Dev mode runs on an in-memory store until PostgreSQL is connected;
  `prisma-store.ts` is the production store. Verified 2026-11-03 after install:
  `next build` passes (all routes), `tsc --noEmit` passes, and a live smoke
  test of the running server passed end-to-end (OTP request → verify new user
  → 10,000-chip SIGNUP_BONUS in wallet → wallet history with session; wallet
  without session correctly returns UNAUTHORIZED). Note: `prisma generate`
  could not download its engine binary from this VM (network disconnect) —
  it runs as part of production deployment instead (Phase 7).
- [x] **Phase 3** — Rooms & lobby (`src/server/rooms.ts`): public rooms listed in
  the lobby, private rooms with a unique 6-character code + scrypt-hashed
  password, 2–6 seats, host ownership (transfers when the host leaves, room
  closes when empty), WhatsApp invite links. Full game state machine over
  Socket.IO (`src/server/game.ts` + `server.ts`): host starts with ≥2 seated,
  boot collected atomically (all balances pre-checked, refund on failure),
  server-side deal, Blind/Seen/Chaal (with raise)/Pack/Show/Side Show, turns
  enforced server-side, pot settled to exactly one winner through the wallet
  ledger, per-action idempotency keys (a replayed action never double-debits).
  Cards exist only in server memory and reach a player solely as `hand:private`
  on their own authenticated socket; `table:state` contains no cards. REST
  routes `/api/rooms`, `/api/rooms/[code]` (+ `/join`, `/leave`) and a `/lobby`
  page (create/join/list + invite link). Tests: **30/30 pass** (9 Phase 1 +
  7 Phase 2 + 14 Phase 3, incl. chip conservation, show/side-show settlement,
  replay protection, atomic start). Verified 2026-11-04: `next build` passes,
  `tsc --noEmit` passes, and a live smoke test over REST + Socket.IO played a
  full round end-to-end (register → room → join → start → private hands →
  pack → pot paid, balances 10010/9990). Room/game table state is in-memory in
  dev (like Redis presence in production); users/wallets use the Phase 2 store.
- [x] **Phase 4** — Table UI / PWA screens. Table screen at `/room/[code]`:
  dark emerald felt with gold trim, six seats laid out around the viewer
  (your seat is always at the bottom), avatars with initials, per-seat chip
  balances, central pot + stake + turn indicator, animated card dealing.
  Your cards render face-up only on your own screen after you press
  "See cards" (opponents only ever see card backs — the server never sends
  their cards). Action bar mirrors the server rules exactly (See / Chaal /
  Raise / Side Show / Show / Pack enable only when legal), winner banner
  with revealed showdown hands, WhatsApp invite and leave in the top bar.
  Plus `/profile` with display-name editing (`/api/auth/me`), a polished
  wallet history (labels, notes, dates), and the finished PWA: service
  worker caching the app shell only (API/socket traffic is never cached)
  and generated 192/512 app icons. Tests: **35/35 pass**. Verified
  2026-11-04: `next build` + `tsc --noEmit` pass, live smoke test 23/23
  (all pages, PWA assets, profile API, and a full socket round played
  through the table's own events, settling 10010/9990).
- [x] **Phase 5** — Admin dashboard (`/admin`, `src/server/admin.ts`,
  `/api/admin/*`). Role-guarded on every route (401 anonymous, 403 player).
  Admins are bootstrapped by the owner only: mobile numbers in the
  `ADMIN_MOBILES` env setting are promoted to ADMIN at login — there is no
  in-app path to admin. Dashboard shows an overview (users, suspensions,
  live rooms, open reports, chips in circulation), user search with live
  balances, suspend/reactivate, and virtual-chip grant/deduct. Every
  moderation action requires a reason and writes an audit-log row; chip
  changes move through the wallet ledger (`ADMIN_GRANT`/`ADMIN_DEDUCT`),
  never by editing balances. Rooms list includes private rooms; closing a
  room mid-round aborts it and refunds every bet through the ledger.
  Players file reports from the table screen (`/api/reports`); admins
  review/dismiss them in the dashboard. A suspension now bites everywhere:
  login, all session APIs and live socket connections are refused.
  Tests: **43/43 pass** (8 new Phase 5 tests incl. chip conservation on
  mid-round room close). Verified 2026-11-04: build + typecheck pass, live
  smoke 20/20 over HTTP with a real `ADMIN_MOBILES` admin.
- [x] Phase 6 — Six-player simulation + reconnect + security + chip-accounting tests — `npm run test:all`: 45 unit/simulation tests (incl. 25 bot-driven six-player rounds with per-round chip conservation and a full ledger audit) + 6 live integration tests (real server, six Socket.IO sessions: privacy, side show, showdown, reconnect restore, disconnect-grace auto-pack, wire security, OTP brute force) — all passing 2026-11-04, plus disconnect grace in server.ts (RECONNECT_GRACE_MS, default 30s: a player who drops mid-round keeps seat+hand; if the window expires the server packs them)
- [~] Phase 7 — Free public deployment. Owner decision 2026-11-05: NO paid hosting/SMS — friends message the owner, the owner creates their accounts. DONE: owner-created accounts (Admin → "Create account for a friend", username + scrypt-hashed password, same 10,000-chip bonus exactly once, audit-logged; friends sign in via username+password on /login; owner can reset any password from the dashboard; tests/phase7.test.ts 5/5 + live smoke 11/11). PENDING owner pick: free hosting (e.g. Render free tier + Neon Postgres + Upstash Redis, or Oracle Cloud Always Free) and the owner's own signup on it.

Run the rules tests with: `npm test`

## Live launch needs
Public HTTPS hosting (Node + PostgreSQL + Redis) and an SMS provider account for
real OTP delivery. The Easypaisa payment module is modelled but **disabled**
pending legal review and provider approval.
