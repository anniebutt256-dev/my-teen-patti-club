import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryStore, type UserRecord } from "../src/server/store.ts";
import { DevSmsSender, OtpService } from "../src/server/otp.ts";
import { WalletService } from "../src/server/wallet.ts";
import { AuthService } from "../src/server/auth.ts";
import { RoomService } from "../src/server/rooms.ts";
import { GameService } from "../src/server/game.ts";
import { AdminService } from "../src/server/admin.ts";

function setup() {
  const store = new InMemoryStore();
  const sms = new DevSmsSender();
  const otp = new OtpService(store, sms);
  const wallet = new WalletService(store);
  const auth = new AuthService(store, otp, wallet);
  const rooms = new RoomService(store);
  const game = new GameService(wallet, rooms, store);
  const admin = new AdminService(store, wallet, rooms, game);
  return { store, sms, otp, wallet, auth, rooms, game, admin };
}

let mobileSeq = 100;
async function makeUser(
  ctx: ReturnType<typeof setup>,
  username: string,
): Promise<UserRecord> {
  mobileSeq += 1;
  const mobile = `+92322222${String(mobileSeq).padStart(4, "0")}`;
  await ctx.auth.requestOtp(mobile);
  const code = ctx.sms.lastCode.get(mobile)!;
  const { user } = await ctx.auth.verifyAndLogin(mobile, code, { username });
  return user;
}

async function makeAdmin(ctx: ReturnType<typeof setup>, username: string) {
  const user = await makeUser(ctx, username);
  const rec = (await ctx.store.findUserById(user.id))!;
  rec.role = "ADMIN";
  await ctx.store.updateUser(rec);
  return rec;
}

test("admin guard: every admin method refuses a plain player", async () => {
  const ctx = setup();
  const player = await makeUser(ctx, "not_admin");
  await assert.rejects(() => ctx.admin.listUsers(player), /FORBIDDEN/);
  await assert.rejects(() => ctx.admin.overview(player), /FORBIDDEN/);
  await assert.rejects(
    () => ctx.admin.adjustChips(player, player.id, "grant", 100, "test reason"),
    /FORBIDDEN/,
  );
  await assert.rejects(() => ctx.admin.listReports(player), /FORBIDDEN/);
  await assert.rejects(() => ctx.admin.listAudit(player), /FORBIDDEN/);
});

test("users: search finds by username/mobile and shows live balances", async () => {
  const ctx = setup();
  const admin = await makeAdmin(ctx, "boss_a");
  await makeUser(ctx, "searchable_sam");
  await makeUser(ctx, "other_omar");
  const all = await ctx.admin.listUsers(admin);
  assert.equal(all.length, 3);
  assert.ok(all.every((u) => u.balance === 10_000));
  const found = await ctx.admin.listUsers(admin, "sam");
  assert.deepEqual(found.map((u) => u.username), ["searchable_sam"]);
});

test("suspend: blocks login, writes audit, cannot target self or another admin", async () => {
  const ctx = setup();
  const admin = await makeAdmin(ctx, "boss_b");
  const admin2 = await makeAdmin(ctx, "boss_b2");
  const bad = await makeUser(ctx, "bad_actor");

  await assert.rejects(
    () => ctx.admin.setUserStatus(admin, admin.id, "SUSPENDED", "self test"),
    /CANNOT_MODERATE_SELF/,
  );
  await assert.rejects(
    () => ctx.admin.setUserStatus(admin, admin2.id, "SUSPENDED", "turf war"),
    /CANNOT_SUSPEND_ADMIN/,
  );
  await assert.rejects(
    () => ctx.admin.setUserStatus(admin, bad.id, "SUSPENDED", ""),
    /REASON_REQUIRED/,
  );

  await ctx.admin.setUserStatus(admin, bad.id, "SUSPENDED", "abusive behaviour");
  // Login is now refused for the suspended account.
  await ctx.auth.requestOtp(bad.mobileNumber);
  const code = ctx.sms.lastCode.get(bad.mobileNumber)!;
  await assert.rejects(() => ctx.auth.verifyAndLogin(bad.mobileNumber, code), /ACCOUNT_SUSPENDED/);

  const audit = await ctx.admin.listAudit(admin);
  const entry = audit.find((a) => a.action === "USER_SUSPEND");
  assert.ok(entry && entry.reason === "abusive behaviour" && entry.targetId === bad.id);

  await ctx.admin.setUserStatus(admin, bad.id, "ACTIVE", "appeal accepted");
  await ctx.auth.requestOtp(bad.mobileNumber);
  const code2 = ctx.sms.lastCode.get(bad.mobileNumber)!;
  const back = await ctx.auth.verifyAndLogin(bad.mobileNumber, code2);
  assert.equal(back.user.status, "ACTIVE");
});

test("chips: grant/deduct need a reason, move through the ledger, and are audited", async () => {
  const ctx = setup();
  const admin = await makeAdmin(ctx, "boss_c");
  const user = await makeUser(ctx, "chip_user");

  await assert.rejects(
    () => ctx.admin.adjustChips(admin, user.id, "grant", 500, ""),
    /REASON_REQUIRED/,
  );
  await assert.rejects(
    () => ctx.admin.adjustChips(admin, user.id, "grant", 0, "zero grant"),
    /INVALID_AMOUNT/,
  );
  await assert.rejects(
    () => ctx.admin.adjustChips(admin, user.id, "grant", 10.5, "fraction"),
    /INVALID_AMOUNT/,
  );

  await ctx.admin.adjustChips(admin, user.id, "grant", 500, "event prize");
  assert.equal(await ctx.wallet.getBalance(user.id), 10_500);
  await ctx.admin.adjustChips(admin, user.id, "deduct", 200, "chargeback correction");
  assert.equal(await ctx.wallet.getBalance(user.id), 10_300);
  await assert.rejects(
    () => ctx.admin.adjustChips(admin, user.id, "deduct", 99_999, "too much"),
    /INSUFFICIENT_CHIPS/,
  );

  const history = await ctx.wallet.history(user.id);
  assert.ok(history.some((t) => t.type === "ADMIN_GRANT" && t.amount === 500));
  assert.ok(history.some((t) => t.type === "ADMIN_DEDUCT" && t.amount === -200));
  const audit = await ctx.admin.listAudit(admin);
  const grant = audit.find((a) => a.action === "CHIP_GRANT");
  assert.ok(grant && JSON.parse(grant.meta!).amount === 500);
});

test("reports: players file them, admins review them, audit is written", async () => {
  const ctx = setup();
  const admin = await makeAdmin(ctx, "boss_d");
  const reporter = await makeUser(ctx, "reporter_r");
  const target = await makeUser(ctx, "target_t");
  const room = await ctx.rooms.createRoom(reporter, {});

  const report = await ctx.admin.createReport(reporter, {
    targetId: target.id,
    roomCode: room.code,
    reason: "Kept stalling every turn on purpose",
  });
  assert.equal(report.status, "OPEN");
  assert.equal(report.roomId, room.id);

  await assert.rejects(
    () => ctx.admin.createReport(reporter, { targetId: reporter.id, reason: "self report" }),
    /CANNOT_REPORT_SELF/,
  );
  await assert.rejects(
    () => ctx.admin.createReport(reporter, { targetUsername: "ghost_user", reason: "who dis" }),
    /TARGET_NOT_FOUND/,
  );
  await assert.rejects(
    () => ctx.admin.createReport(reporter, { reason: "no" }),
    /INVALID_REASON/,
  );

  const open = await ctx.admin.listReports(admin, "OPEN");
  assert.equal(open.length, 1);
  assert.equal(open[0].reporterUsername, "reporter_r");
  assert.equal(open[0].targetUsername, "target_t");

  await ctx.admin.reviewReport(admin, report.id, "REVIEWED");
  assert.equal((await ctx.admin.listReports(admin, "OPEN")).length, 0);
  const reviewed = (await ctx.admin.listReports(admin, "REVIEWED"))[0];
  assert.ok(reviewed.reviewedAt !== null);
  const audit = await ctx.admin.listAudit(admin);
  assert.ok(audit.some((a) => a.action === "REPORT_REVIEW" && a.targetId === report.id));
});

test("rooms: admin close removes a waiting room and needs a reason", async () => {
  const ctx = setup();
  const admin = await makeAdmin(ctx, "boss_e");
  const host = await makeUser(ctx, "room_host");
  const room = await ctx.rooms.createRoom(host, { type: "PRIVATE", password: "pw1234" });

  // Private rooms show up in the admin list even though the lobby hides them.
  const listed = await ctx.admin.listAllRooms(admin);
  assert.deepEqual(listed.map((r) => r.code), [room.code]);

  await assert.rejects(() => ctx.admin.closeRoom(admin, room.code, ""), /REASON_REQUIRED/);
  const res = await ctx.admin.closeRoom(admin, room.code, "duplicate table");
  assert.equal(res.closed, true);
  assert.equal(res.refunded, 0);
  assert.equal(ctx.rooms.getByCode(room.code), null);
});

test("rooms: closing mid-round refunds every bet — chips are conserved", async () => {
  const ctx = setup();
  const admin = await makeAdmin(ctx, "boss_f");
  const host = await makeUser(ctx, "mid_host");
  const guest = await makeUser(ctx, "mid_guest");
  const room = await ctx.rooms.createRoom(host, {});
  await ctx.rooms.joinRoom(guest, room.code);
  await ctx.game.startRound(host.id, room); // boot 10 each -> pot 20
  await ctx.game.act(guest.id, room, { type: "chaal" }); // blind 10 -> pot 30

  const res = await ctx.admin.closeRoom(admin, room.code, "suspected collusion");
  assert.equal(res.refunded, 30);
  assert.equal(await ctx.wallet.getBalance(host.id), 10_000);
  assert.equal(await ctx.wallet.getBalance(guest.id), 10_000);
  assert.equal(ctx.game.activeRound(room.id), null);
  const audit = await ctx.admin.listAudit(admin);
  const entry = audit.find((a) => a.action === "ROOM_CLOSE");
  assert.ok(entry && JSON.parse(entry.meta!).refunded === 30);
});

test("bootstrap: ADMIN_MOBILES promotes at login; unlisted numbers stay players", async () => {
  const ctx = setup();
  const bossMobile = "+923222229999";
  process.env.ADMIN_MOBILES = bossMobile;
  try {
    await ctx.auth.requestOtp(bossMobile);
    const code = ctx.sms.lastCode.get(bossMobile)!;
    const { user } = await ctx.auth.verifyAndLogin(bossMobile, code, { username: "the_boss" });
    assert.equal(user.role, "ADMIN");
    // The promoted admin can immediately use the admin service.
    const users = await ctx.admin.listUsers(user);
    assert.ok(users.length >= 1);
  } finally {
    delete process.env.ADMIN_MOBILES;
  }
  const plain = await makeUser(ctx, "plain_pete");
  assert.equal(plain.role, "PLAYER");
});
