import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryStore, type UserRecord } from "../src/server/store.ts";
import { DevSmsSender, OtpService } from "../src/server/otp.ts";
import { WalletService } from "../src/server/wallet.ts";
import { AuthService } from "../src/server/auth.ts";
import { RoomService } from "../src/server/rooms.ts";
import { GameService } from "../src/server/game.ts";
import { AdminService } from "../src/server/admin.ts";

// Phase 7 (free launch) — owner-created accounts + username/password login.
// Friends message the owner; the owner creates the account from the admin
// dashboard; the friend signs in with username + password. No SMS anywhere.

process.env.ADMIN_MOBILES = "+923444444444";

function setup() {
  const store = new InMemoryStore();
  const sms = new DevSmsSender();
  const otp = new OtpService(store, sms);
  const wallet = new WalletService(store);
  const auth = new AuthService(store, otp, wallet);
  const rooms = new RoomService(store);
  const game = new GameService(wallet, rooms, store);
  const admin = new AdminService(store, wallet, rooms, game);
  return { store, sms, wallet, auth, rooms, game, admin };
}

async function makeOwner(ctx: ReturnType<typeof setup>): Promise<UserRecord> {
  await ctx.auth.requestOtp("+923444444444");
  const code = ctx.sms.lastCode.get("+923444444444")!;
  const { user } = await ctx.auth.verifyAndLogin("+923444444444", code, { username: "club_owner" });
  assert.equal(user.role, "ADMIN");
  return user;
}

async function makePlayer(ctx: ReturnType<typeof setup>, mobile: string, username: string): Promise<UserRecord> {
  await ctx.auth.requestOtp(mobile);
  const code = ctx.sms.lastCode.get(mobile)!;
  const { user } = await ctx.auth.verifyAndLogin(mobile, code, { username });
  return user;
}

test("createAccount: friend gets 10,000 chips once, hashed password, audit row", async () => {
  const ctx = setup();
  const owner = await makeOwner(ctx);
  const created = await ctx.admin.createAccount(owner, {
    username: "friend_one",
    password: "tiger123",
    displayName: "Friend One",
  });
  assert.equal(created.balance, 10_000);
  const stored = await ctx.store.findUserByUsername("friend_one");
  assert.ok(stored);
  assert.ok(stored!.passwordHash && stored!.passwordHash.includes(":"));
  assert.ok(!stored!.passwordHash!.includes("tiger123"), "password stored in plaintext!");
  assert.equal(stored!.mobileNumber, "manual:friend_one");
  const history = await ctx.wallet.history(stored!.id, 10);
  assert.equal(history.filter((t) => t.type === "SIGNUP_BONUS").length, 1);
  const audit = await ctx.store.listAudit(10);
  assert.ok(audit.some((a) => a.action === "USER_CREATE" && a.targetId === stored!.id));
  const listed = await ctx.admin.listUsers(owner, "friend_one");
  assert.equal(listed[0].hasPassword, true);
});

test("createAccount: validation — taken/invalid username, weak password, non-admin refused", async () => {
  const ctx = setup();
  const owner = await makeOwner(ctx);
  const player = await makePlayer(ctx, "+923444444445", "plain_player");
  await ctx.admin.createAccount(owner, { username: "taken_name", password: "tiger123" });
  await assert.rejects(() => ctx.admin.createAccount(owner, { username: "TAKEN_NAME", password: "tiger123" }), /USERNAME_TAKEN/);
  await assert.rejects(() => ctx.admin.createAccount(owner, { username: "ab", password: "tiger123" }), /USERNAME_INVALID/);
  await assert.rejects(() => ctx.admin.createAccount(owner, { username: "bad name!", password: "tiger123" }), /USERNAME_INVALID/);
  await assert.rejects(() => ctx.admin.createAccount(owner, { username: "ok_name", password: "123" }), /PASSWORD_WEAK/);
  await assert.rejects(() => ctx.admin.createAccount(player, { username: "sneaky", password: "tiger123" }), /FORBIDDEN/);
});

test("password login: works, wrong/unknown refused generically, bonus never doubles", async () => {
  const ctx = setup();
  const owner = await makeOwner(ctx);
  await ctx.admin.createAccount(owner, { username: "friend_two", password: "tiger123" });
  const { user, token } = await ctx.auth.loginWithPassword("Friend_Two", "tiger123");
  assert.equal(user.username, "friend_two");
  assert.ok(token.length > 10);
  assert.equal(await ctx.wallet.getBalance(user.id), 10_000);
  await ctx.auth.loginWithPassword("friend_two", "tiger123");
  assert.equal(await ctx.wallet.getBalance(user.id), 10_000, "bonus granted twice");
  await assert.rejects(() => ctx.auth.loginWithPassword("friend_two", "wrong-pass"), /INVALID_CREDENTIALS/);
  await assert.rejects(() => ctx.auth.loginWithPassword("no_such_user", "tiger123"), /INVALID_CREDENTIALS/);
  // An OTP-only account (no password set) gets the same generic refusal.
  await makePlayer(ctx, "+923444444446", "otp_only");
  await assert.rejects(() => ctx.auth.loginWithPassword("otp_only", "tiger123"), /INVALID_CREDENTIALS/);
});

test("password login: suspended manual account is refused", async () => {
  const ctx = setup();
  const owner = await makeOwner(ctx);
  const created = await ctx.admin.createAccount(owner, { username: "bad_actor", password: "tiger123" });
  await ctx.admin.setUserStatus(owner, created.id, "SUSPENDED", "test suspension");
  await assert.rejects(() => ctx.auth.loginWithPassword("bad_actor", "tiger123"), /ACCOUNT_SUSPENDED/);
});

test("owner bootstrap: first login with env credentials creates the ADMIN account — only on an empty table", async () => {
  const ctx = setup();
  process.env.OWNER_USERNAME = "club_boss";
  process.env.OWNER_PASSWORD = "bosspass1";
  try {
    // Wrong password: refused, and no account is created.
    await assert.rejects(() => ctx.auth.loginWithPassword("club_boss", "nope-nope"), /INVALID_CREDENTIALS/);
    assert.equal((await ctx.store.listUsers("", 10)).length, 0);
    // A different username never triggers the bootstrap.
    await assert.rejects(() => ctx.auth.loginWithPassword("someone_else", "bosspass1"), /INVALID_CREDENTIALS/);
    assert.equal((await ctx.store.listUsers("", 10)).length, 0);
    // Correct credentials on the empty table: owner account appears as ADMIN.
    const { user } = await ctx.auth.loginWithPassword("club_boss", "bosspass1");
    assert.equal(user.role, "ADMIN");
    assert.equal(await ctx.wallet.getBalance(user.id), 10_000);
    // And the bootstrapped owner can immediately create friend accounts.
    const friend = await ctx.admin.createAccount(user, { username: "first_friend", password: "tiger123" });
    assert.equal(friend.balance, 10_000);
  } finally {
    delete process.env.OWNER_USERNAME;
    delete process.env.OWNER_PASSWORD;
  }
});

test("owner bootstrap: never fires once any user exists", async () => {
  const ctx = setup();
  await makePlayer(ctx, "+923444444448", "early_player");
  process.env.OWNER_USERNAME = "late_boss";
  process.env.OWNER_PASSWORD = "bosspass1";
  try {
    await assert.rejects(() => ctx.auth.loginWithPassword("late_boss", "bosspass1"), /INVALID_CREDENTIALS/);
    assert.equal(await ctx.store.findUserByUsername("late_boss"), null);
  } finally {
    delete process.env.OWNER_USERNAME;
    delete process.env.OWNER_PASSWORD;
  }
});

test("resetPassword: needs a reason, replaces the password, works on OTP accounts too", async () => {
  const ctx = setup();
  const owner = await makeOwner(ctx);
  const created = await ctx.admin.createAccount(owner, { username: "forgetful", password: "tiger123" });
  await assert.rejects(() => ctx.admin.resetPassword(owner, created.id, "newpass9", ""), /REASON_REQUIRED/);
  await assert.rejects(() => ctx.admin.resetPassword(owner, created.id, "123", "forgot password"), /PASSWORD_WEAK/);
  await ctx.admin.resetPassword(owner, created.id, "newpass9", "forgot password, owner reset");
  await assert.rejects(() => ctx.auth.loginWithPassword("forgetful", "tiger123"), /INVALID_CREDENTIALS/);
  const { user } = await ctx.auth.loginWithPassword("forgetful", "newpass9");
  assert.equal(user.id, created.id);
  const audit = await ctx.store.listAudit(10);
  assert.ok(audit.some((a) => a.action === "USER_PASSWORD_RESET" && a.targetId === created.id));
  // OTP-created account gains password login after an owner reset.
  const otpUser = await makePlayer(ctx, "+923444444447", "otp_friend");
  await ctx.admin.resetPassword(owner, otpUser.id, "friendpass1", "friend asked for password login");
  const login = await ctx.auth.loginWithPassword("otp_friend", "friendpass1");
  assert.equal(login.user.id, otpUser.id);
});
