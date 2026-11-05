# Free deployment guide — MY TEEN PATTI CLUB (Rs 0, no card anywhere)

Stack chosen for zero cost (2026-11-05):
- **Render** free web service — runs the game server (sleeps when idle; the
  first visitor waits ~1 minute for it to wake, then it plays normally).
- **Neon** free PostgreSQL — accounts, wallets and the chip ledger live here.
  (Render's own free database deletes itself after 30 days — do NOT use it.)
- No SMS provider and no Redis: friends get accounts from the owner
  (admin dashboard → Create account), and the single free server keeps
  room/game state in memory, which is all a friends-scale club needs.

You (the owner) do the three signups — they must be in your name. Everything
else is prepared. Total time: about 10 minutes.

## Step 1 — GitHub (the code's home)
1. Go to github.com → Sign up (free, no card). Skip if you already have an account.
2. Click **+ → New repository**, name it `my-teen-patti-club`, choose **Public**, Create.
3. Download `my-teen-patti-club-upload.zip` (Muse gives you the file), unzip it.
4. In the new repo click **Add file → Upload files**, drag ALL the unzipped
   files and folders in, and Commit. (Never upload `node_modules` or `.next` —
   they are not in the zip.)

## Step 2 — Neon (the database)
1. Go to neon.tech → Sign up with Google or GitHub (free, no card).
2. **New Project** → name it `teen-patti` → Create.
3. On the project dashboard, copy the **connection string** (starts with
   `postgresql://`). Use the **direct** string (not the "pooled" one).
   Keep it private — it is the key to the database.

## Step 3 — Render (the server)
1. Go to render.com → Get Started → sign up **with GitHub** (free, no card).
2. **New → Blueprint** → connect the `my-teen-patti-club` repository.
3. Render reads `render.yaml` and asks for the secret values:
   - `DATABASE_URL` → paste the Neon connection string from Step 2.
   - `OWNER_USERNAME` → pick your admin username (3–20 characters).
   - `OWNER_PASSWORD` → pick a strong password. **Remember it** — it becomes
     your admin login, and it is never shown again.
   - `PUBLIC_BASE_URL` → leave blank for the first deploy.
4. Apply / Create. The first build takes a few minutes.
5. When it is live, copy the service URL (`https://my-teen-patti-club-xxxx.onrender.com`),
   go to the service's **Environment** tab, set `PUBLIC_BASE_URL` to that URL,
   and save (it redeploys once).

## Step 4 — First login (you become the admin)
1. Open the service URL → **Login** → use the "Invited by the club owner?"
   box with your `OWNER_USERNAME` + `OWNER_PASSWORD`.
   The first login creates your admin account automatically, with 10,000 chips.
2. Go to **Admin** → **Create account for a friend** for each friend who
   messages you: choose their username + a password, and tell them both
   (e.g. on WhatsApp). They sign in the same way and get 10,000 chips.
3. Create a room, share the WhatsApp invite link from the lobby, and play.

## Honest limits of free
- The server sleeps after ~15 minutes with no visitors. The first person to
  open the link waits about a minute; after that it stays awake while you play.
- Free Render gives 750 instance-hours/month — plenty for evening games with
  friends, not for a 24×7 public site.
- Neon free holds 0.5 GB — years of club ledgers at friends scale.
- If the club ever outgrows free, the same code deploys unchanged on a paid
  plan (~$20–30/month) and the database stays on Neon.
