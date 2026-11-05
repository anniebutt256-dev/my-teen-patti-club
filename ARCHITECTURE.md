# MY TEEN PATTI CLUB — Architecture (Phase 1, established 2026-11-03)

## Product summary
Multiplayer Classic Teen Patti for friends on separate phones. Mobile-first installable PWA
(Android, iPhone, desktop). Virtual chips only — **no real-money wagering, deposits or
withdrawals in v1**. Each new verified account receives **10,000 free virtual chips, once**.

## Stack
- **Web/PWA:** Next.js (React, TypeScript, App Router), responsive, installable (manifest + service worker)
- **Realtime/game server:** Node.js custom server with **Socket.IO** (rooms, turns, reconnects)
- **Database:** PostgreSQL via **Prisma** ORM
- **Ephemeral state:** Redis (Socket.IO adapter for multi-instance scaling, OTP rate-limit counters,
  room presence, reconnect grace windows)
- **Auth:** Mobile number + OTP (SMS provider, see "Live launch needs"), then a signed session (httpOnly cookie / JWT)
- **Payments:** Architecture kept separate and **DISABLED** (see §8)

## Trust boundary (non-negotiable)
The **server is the only authority** over: deck shuffling (CSPRNG Fisher–Yates), dealing,
whose turn it is, legal actions, pot accounting, and winner calculation.
Clients only *request* actions and *render* state. A player's cards are stored server-side
(`PlayerHand`) and are sent **only to that player** over their authenticated socket —
never broadcast. Show / Side Show reveals happen only through server-resolved events.

## Modules (built in this order)
1. **Foundation** — project scaffold, Prisma schema, migrations, seed (admin user, chip config)
2. **Auth** — OTP request/verify (hashed codes, expiry, attempt + rate limits), unique username
   claim, profile (avatar, display name), session, logout, account status (active/suspended)
3. **Wallet** — one wallet per user; every chip movement is an append-only `ChipTransaction`
   ledger row inside a DB transaction; balance is never edited directly. Signup bonus is a
   ledger row of type `SIGNUP_BONUS` (unique per user — enforced in schema). Boot/chaal debits
   and pot winnings are ledger rows tied to the round.
4. **Rooms & lobby** — public rooms (discoverable) and private rooms (unique room code +
   password hash), 2–6 seats, host controls (start when ≥2 seated, set boot within table limits),
   WhatsApp invite link (`https://wa.me/?text=…` carrying the room code/link)
5. **Game engine** (`src/game/`) — pure, unit-tested rules core: deck, secure shuffle, hand
   evaluation and comparison (Trail > Pure Sequence > Sequence > Color > Pair > High Card),
   turn state machine (Blind / Seen / Chaal with blind:seen = 1:2 stake ratio, Pack, Show,
   Side Show), boot collection, pot and side-pot-free Classic settlement, winner + ledger payout
6. **Realtime layer** — Socket.IO events (see §6), presence, disconnect grace + auto-pack on
   timeout, reconnect restores the player's own hand and the table state
7. **Client** — lobby, table UI (dark emerald felt, gold accents, 6 seats, avatars, chip stacks,
   central pot, animated dealing/betting), wallet + history screens, profile
8. **Admin** — separate role-guarded dashboard: users (search, suspend), rooms (live/closed),
   reports (player-submitted), virtual chip controls (grant/deduct **with audit log + reason**)

## Socket.IO protocol (v1)
Client → server: `room:join`, `room:leave`, `game:start`, `game:action`
(`{ type: 'chaal' | 'pack' | 'show' | 'sideshow' | 'seen', targetPlayerId? }`), `chat:send` (optional, later)
Server → client: `table:state` (public state only), `hand:private` (own cards, own socket only),
`turn:changed`, `pot:updated`, `round:result`, `wallet:updated`, `room:players`, `error`
All events are authenticated; the server re-validates seat, turn and balance for every action.

## Game rules encoded (Classic)
- 52-card deck, 3 cards each, boot (ante) collected from every seated player before dealing.
- Blind players bet the stake; Seen players bet 2× stake. Chaal raises follow the table's
  stake ladder. Last remaining player wins the pot; Show compares the two remaining hands;
  Side Show compares the requester with the previous player (requester packs if lower,
  only when both are Seen). Winner is paid from the pot via wallet ledger in one DB transaction.
- Hand rankings, strongest → weakest: **Trail/Trio, Pure Sequence, Sequence, Color (flush),
  Pair, High Card**. Sequence order: AKQ > A23 > KQJ > QJT > JT9 > T98 > 987 > 876 > 765 >
  654 > 543 > 432.

## Security
- OTP codes stored hashed (SHA-256 + per-code salt), 5-minute expiry, max attempts, per-number
  and per-IP rate limits (Redis), no OTP in logs.
- Passwords (room) and any credentials hashed with bcrypt/argon2; session tokens signed, httpOnly.
- Every wallet mutation in a serializable transaction; idempotency key per game action so a
  retried socket event can never double-debit.
- Admin actions written to `AdminAuditLog`; chip grants require a reason.
- Input validation on every API/socket payload; rate limiting on auth and actions.

## Testing gate (no completion claim before these pass) — PASSED 2026-11-04
- Unit: hand rankings + comparisons, shuffle/deal uniqueness, stake/pot maths ✓
- Integration: **six simulated player sessions** over Socket.IO — join one room, full rounds,
  Show and Side Show paths, chip conservation (sum of balances + pot is constant), ledger audit ✓
  (tests/phase6.integration.test.ts, `npm run test:integration`)
- Simulation: 25 bot-driven six-player rounds at service level; after every round the pot equals
  the sum of bets, balances match the ledger exactly, per-round debits equal the winner's credit,
  and the six private hands are pairwise disjoint ✓ (tests/phase6.test.ts)
- Reconnect: a player disconnects mid-round and reconnects — gets own hand back, no one else's ✓;
  a turn holder who stays away past the grace window (RECONNECT_GRACE_MS, default 30s) is
  auto-packed by the server ✓
- Security: OTP brute-force limits, joining a private room without password fails, acting out
  of turn fails, double-action replay fails (idempotency), a player can never receive another
  player's cards ✓
- Full gate: `npm run test:all` = 45 unit/simulation + 6 integration tests, all passing,
  plus `next build` and `tsc --noEmit`.

## PWA
Manifest (name, icons, theme #046A38 emerald / gold), service worker for shell caching,
install prompts for Android/desktop; iOS "Add to Home Screen" guidance screen.

## Live launch needs (outside the codebase — decided with the owner before public launch)
1. **Hosting** with a public HTTPS domain (Node server + PostgreSQL + Redis) — friends join
   over the public internet, so the game cannot live only inside the Muse app/VM.
2. **SMS provider account** for OTP (e.g., a Pakistan-capable provider) — OTP codes are sent
   by the provider; dev mode uses a local test code until a provider is connected.
3. **Easypaisa stays OFF** until legal review + provider approval exist; the disabled payment
   module (§8 of the schema notes) is not wired to any wallet flow.

## Build phases
- [x] Phase 1 — Architecture + Prisma database schema + tested game-rules core
- [x] Phase 2 — Scaffold Next.js app + custom Socket.IO server, auth (OTP) + wallet ledger (tests 16/16)
- [x] Phase 3 — Rooms/lobby + WhatsApp invites + full game state machine over sockets (done 2026-11-04, tests 30/30; room passwords scrypt-hashed, per-action idempotency, atomic boot collection)
- [x] Phase 4 — Table UI (PWA) + wallet/profile screens (done 2026-11-04, tests 35/35; service worker shell cache, app icons, /api/auth/me)
- [x] Phase 5 — Admin dashboard + reports (done 2026-11-04, tests 43/43; ADMIN_MOBILES bootstrap, reason + audit on every action, mid-round close refunds all bets, suspension enforced at login/API/socket)
- [x] Phase 6 — Six-player simulation, reconnect, security and chip-accounting test gate (passed 2026-11-04)
- [~] Phase 7 — Free deployment (owner decision 2026-11-05: no paid hosting, no SMS provider — owner creates friends' accounts manually; password login added, OTP kept for the owner's own number). Hosting pick + owner signup still pending.
