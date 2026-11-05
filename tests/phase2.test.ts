import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryStore } from "../src/server/store.ts";
import { DevSmsSender, OtpService } from "../src/server/otp.ts";
import { WalletService, SIGNUP_BONUS } from "../src/server/wallet.ts";
import { AuthService } from "../src/server/auth.ts";
import { signSession, verifySession } from "../src/server/session.ts";

function setup(nowRef = { t: Date.now() }) {
  const store = new InMemoryStore();
  const sms = new DevSmsSender();
  const otp = new OtpService(store, sms, { now: () => nowRef.t });
  const wallet = new WalletService(store);
  const auth = new AuthService(store, otp, wallet);
  return { store, sms, otp, wallet, auth, nowRef };
}

const MOBILE = "+923001234567";

test("OTP register: new user gets unique username + 10,000 chips exactly once", async () => {
  const { sms, auth, wallet } = setup();
  await auth.requestOtp(MOBILE);
  const code = sms.lastCode.get(MOBILE)!;
  const first = await auth.verifyAndLogin(MOBILE, code, { username: "player_one" });
  assert.equal(first.isNewUser, true);
  assert.equal(await wallet.getBalance(first.user.id), SIGNUP_BONUS);

  // Second login: no second bonus
  await auth.requestOtp(MOBILE);
  const code2 = sms.lastCode.get(MOBILE)!;
  const second = await auth.verifyAndLogin(MOBILE, code2);
  assert.equal(second.isNewUser, false);
  assert.equal(await wallet.getBalance(first.user.id), SIGNUP_BONUS);
  const history = await wallet.history(first.user.id);
  assert.equal(history.filter((t) => t.type === "SIGNUP_BONUS").length, 1);
});

test("OTP: wrong code fails, attempts are counted, code is single-use", async () => {
  const { sms, auth, otp } = setup();
  await auth.requestOtp(MOBILE);
  const code = sms.lastCode.get(MOBILE)!;
  const wrong = code === "000000" ? "111111" : "000000";
  assert.equal(await otp.verifyOtp(MOBILE, wrong), false);
  assert.equal(await otp.verifyOtp(MOBILE, code), true);
  // consumed: cannot be reused
  assert.equal(await otp.verifyOtp(MOBILE, code), false);
});

test("OTP: expired code fails", async () => {
  const nowRef = { t: Date.now() };
  const { sms, auth, otp } = setup(nowRef);
  await auth.requestOtp(MOBILE);
  const code = sms.lastCode.get(MOBILE)!;
  nowRef.t += 6 * 60 * 1000; // past the 5-minute TTL
  assert.equal(await otp.verifyOtp(MOBILE, code), false);
});

test("OTP: rate limit blocks repeated requests", async () => {
  const { auth } = setup();
  for (let i = 0; i < 5; i++) await auth.requestOtp(MOBILE);
  await assert.rejects(() => auth.requestOtp(MOBILE), /OTP_RATE_LIMITED/);
});

test("usernames are unique (case-insensitive)", async () => {
  const { sms, auth } = setup();
  await auth.requestOtp(MOBILE);
  await auth.verifyAndLogin(MOBILE, sms.lastCode.get(MOBILE)!, {
    username: "Champ",
  });
  const other = "+923009999999";
  await auth.requestOtp(other);
  await assert.rejects(
    () => auth.verifyAndLogin(other, sms.lastCode.get(other)!, { username: "champ" }),
    /USERNAME_TAKEN/,
  );
});

test("wallet: idempotent movements never double-post; overdraft is rejected", async () => {
  const { wallet, store } = setup();
  const u = "user_test";
  await store.createWallet({ userId: u, balance: 0 });
  await wallet.applyMovement(u, "ADMIN_GRANT", 500, "grant-1");
  const again = await wallet.applyMovement(u, "ADMIN_GRANT", 500, "grant-1");
  assert.equal(again.amount, 500);
  assert.equal(await wallet.getBalance(u), 500);

  await wallet.applyMovement(u, "CHAAL", -200, "chaal-1");
  assert.equal(await wallet.getBalance(u), 300);
  await assert.rejects(
    () => wallet.applyMovement(u, "CHAAL", -301, "chaal-2"),
    /INSUFFICIENT_CHIPS/,
  );
  assert.equal(await wallet.getBalance(u), 300);
});

test("sessions: signed token verifies, tampered token fails", () => {
  const token = signSession("user_abc");
  assert.equal(verifySession(token), "user_abc");
  assert.equal(verifySession(token + "x"), null);
  assert.equal(verifySession("garbage"), null);
});
