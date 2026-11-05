// Admin service (Phase 5) — role-guarded moderation and chip controls.
//
// Every method takes the acting user first and refuses non-admins, so the
// guard cannot be skipped by a route that forgets to check. Every mutating
// action requires a reason and writes an AdminAuditLog row; chip movements
// go through the wallet ledger like all others (ADMIN_GRANT / ADMIN_DEDUCT),
// never by editing a balance directly.

import { newId, type Store, type UserRecord } from "./store";
import { WalletService } from "./wallet";
import { USERNAME_RE } from "./auth";
import { assertPasswordStrength, hashPassword } from "./password";
import { RoomService, type RoomRecord } from "./rooms";
import { GameService } from "./game";

export class AdminService {
  private store: Store;
  private wallet: WalletService;
  private rooms: RoomService;
  private game: GameService;

  constructor(store: Store, wallet: WalletService, rooms: RoomService, game: GameService) {
    this.store = store;
    this.wallet = wallet;
    this.rooms = rooms;
    this.game = game;
  }

  private requireAdmin(actor: UserRecord) {
    if (actor.role !== "ADMIN" || actor.status !== "ACTIVE") {
      throw new Error("FORBIDDEN");
    }
  }

  private requireReason(reason?: string): string {
    const r = (reason ?? "").trim();
    if (r.length < 3) throw new Error("REASON_REQUIRED");
    return r;
  }

  private async audit(
    admin: UserRecord,
    action: string,
    targetType: string,
    targetId: string,
    reason: string,
    meta?: Record<string, unknown>,
  ) {
    await this.store.createAudit({
      id: newId("audit"),
      adminId: admin.id,
      action,
      targetType,
      targetId,
      reason,
      meta: meta ? JSON.stringify(meta) : null,
      createdAt: Date.now(),
    });
  }

  async listUsers(actor: UserRecord, search = "") {
    this.requireAdmin(actor);
    const users = await this.store.listUsers(search, 100);
    const out = [];
    for (const u of users) {
      out.push({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        mobileNumber: u.mobileNumber,
        role: u.role,
        status: u.status,
        hasPassword: !!u.passwordHash,
        createdAt: u.createdAt,
        balance: await this.wallet.getBalance(u.id),
      });
    }
    return out;
  }

  /** Owner-created account (Phase 7 free launch): a friend messages the
   *  owner, the owner creates the account here with a username + password,
   *  and the friend signs in with those — no SMS/OTP cost anywhere. The
   *  account gets the same 10,000-chip signup bonus, exactly once, through
   *  the wallet ledger. The placeholder mobile (`manual:<username>`) can
   *  never receive an OTP and never matches ADMIN_MOBILES. */
  async createAccount(
    actor: UserRecord,
    input: { username?: string; password?: string; displayName?: string },
  ) {
    this.requireAdmin(actor);
    const username = (input.username ?? "").trim();
    if (!USERNAME_RE.test(username)) throw new Error("USERNAME_INVALID");
    assertPasswordStrength(input.password ?? "");
    const taken = await this.store.findUserByUsername(username.toLowerCase());
    if (taken) throw new Error("USERNAME_TAKEN");
    const user: UserRecord = {
      id: newId("user"),
      mobileNumber: `manual:${username.toLowerCase()}`,
      username,
      displayName: (input.displayName ?? "").trim() || username,
      avatarUrl: null,
      role: "PLAYER",
      status: "ACTIVE",
      mobileVerified: false,
      passwordHash: hashPassword(input.password!),
      signupBonusGranted: false,
      createdAt: Date.now(),
    };
    await this.store.createUser(user);
    await this.wallet.ensureWallet(user.id);
    const bonus = await this.wallet.grantSignupBonusOnce(user.id);
    if (bonus) {
      user.signupBonusGranted = true;
      await this.store.updateUser(user);
    }
    await this.audit(actor, "USER_CREATE", "USER", user.id, "Owner-created account", { username });
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      balance: await this.wallet.getBalance(user.id),
    };
  }

  /** Set/replace a user's login password (owner helping a friend who forgot
   *  theirs, or enabling password login on an OTP account). Reason +
   *  audit, like every other admin mutation. */
  async resetPassword(actor: UserRecord, userId: string, newPassword?: string, reason?: string) {
    this.requireAdmin(actor);
    const r = this.requireReason(reason);
    assertPasswordStrength(newPassword ?? "");
    const target = await this.store.findUserById(userId);
    if (!target) throw new Error("USER_NOT_FOUND");
    target.passwordHash = hashPassword(newPassword!);
    await this.store.updateUser(target);
    await this.audit(actor, "USER_PASSWORD_RESET", "USER", target.id, r, { username: target.username });
    return { id: target.id, username: target.username };
  }

  async setUserStatus(
    actor: UserRecord,
    userId: string,
    status: "ACTIVE" | "SUSPENDED",
    reason?: string,
  ) {
    this.requireAdmin(actor);
    const why = this.requireReason(reason);
    if (actor.id === userId) throw new Error("CANNOT_MODERATE_SELF");
    const user = await this.store.findUserById(userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    if (user.role === "ADMIN" && status === "SUSPENDED") {
      throw new Error("CANNOT_SUSPEND_ADMIN");
    }
    user.status = status;
    await this.store.updateUser(user);
    await this.audit(
      actor,
      status === "SUSPENDED" ? "USER_SUSPEND" : "USER_ACTIVATE",
      "USER",
      userId,
      why,
    );
    return user;
  }

  async adjustChips(
    actor: UserRecord,
    userId: string,
    mode: "grant" | "deduct",
    amount: number,
    reason?: string,
  ) {
    this.requireAdmin(actor);
    const why = this.requireReason(reason);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 1_000_000) {
      throw new Error("INVALID_AMOUNT");
    }
    const user = await this.store.findUserById(userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    const signed = mode === "grant" ? amount : -amount;
    const tx = await this.wallet.applyMovement(
      userId,
      mode === "grant" ? "ADMIN_GRANT" : "ADMIN_DEDUCT",
      signed,
      `admin:${newId("op")}`,
      `Admin ${mode}: ${why}`,
    );
    await this.audit(
      actor,
      mode === "grant" ? "CHIP_GRANT" : "CHIP_DEDUCT",
      "USER",
      userId,
      why,
      { amount },
    );
    return tx;
  }

  /** All live rooms (public + private) as public views, for the dashboard. */
  async listAllRooms(actor: UserRecord) {
    this.requireAdmin(actor);
    const rooms = this.rooms.listAllRooms();
    const views = [];
    for (const room of rooms) views.push(await this.rooms.publicView(room));
    return views;
  }

  async closeRoom(actor: UserRecord, code: string, reason?: string) {
    this.requireAdmin(actor);
    const why = this.requireReason(reason);
    const room: RoomRecord | null = this.rooms.getByCode(code);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    const refunded = await this.game.abortRound(room);
    this.rooms.closeRoom(room.id);
    await this.audit(actor, "ROOM_CLOSE", "ROOM", room.id, why, {
      code: room.code,
      refunded,
    });
    return { closed: true, refunded };
  }

  // ------------------------------------------------------------- reports

  /** Player-facing: file a report. Not admin-guarded by design. */
  async createReport(
    reporter: UserRecord,
    input: { targetId?: string; targetUsername?: string; roomCode?: string; reason?: string },
  ) {
    const reason = (input.reason ?? "").trim();
    if (reason.length < 3 || reason.length > 500) throw new Error("INVALID_REASON");

    let targetId: string | null = null;
    if (input.targetId || input.targetUsername) {
      const target = input.targetId
        ? await this.store.findUserById(input.targetId)
        : await this.store.findUserByUsername((input.targetUsername ?? "").toLowerCase());
      if (!target) throw new Error("TARGET_NOT_FOUND");
      if (target.id === reporter.id) throw new Error("CANNOT_REPORT_SELF");
      targetId = target.id;
    }

    let roomId: string | null = null;
    if (input.roomCode) {
      const room = this.rooms.getByCode(input.roomCode);
      if (!room) throw new Error("ROOM_NOT_FOUND");
      roomId = room.id;
    }

    const report = {
      id: newId("report"),
      reporterId: reporter.id,
      targetId,
      roomId,
      reason,
      status: "OPEN" as const,
      createdAt: Date.now(),
      reviewedAt: null,
    };
    await this.store.createReport(report);
    return report;
  }

  async listReports(actor: UserRecord, status?: string) {
    this.requireAdmin(actor);
    const reports = await this.store.listReports(status);
    const out = [];
    for (const r of reports) {
      const reporter = await this.store.findUserById(r.reporterId);
      const target = r.targetId ? await this.store.findUserById(r.targetId) : null;
      out.push({
        ...r,
        reporterUsername: reporter?.username ?? "?",
        targetUsername: target?.username ?? null,
      });
    }
    return out;
  }

  async reviewReport(
    actor: UserRecord,
    reportId: string,
    status: "REVIEWED" | "DISMISSED",
    reason?: string,
  ) {
    this.requireAdmin(actor);
    const why = this.requireReason(reason ?? "Reviewed in dashboard");
    const reports = await this.store.listReports();
    const report = reports.find((r) => r.id === reportId);
    if (!report) throw new Error("REPORT_NOT_FOUND");
    report.status = status;
    report.reviewedAt = Date.now();
    await this.store.updateReport(report);
    await this.audit(actor, "REPORT_REVIEW", "REPORT", reportId, why, { status });
    return report;
  }

  async listAudit(actor: UserRecord, limit = 50) {
    this.requireAdmin(actor);
    return this.store.listAudit(limit);
  }

  async overview(actor: UserRecord) {
    this.requireAdmin(actor);
    const users = await this.store.listUsers("", 1000);
    let chipsInCirculation = 0;
    for (const u of users) chipsInCirculation += await this.wallet.getBalance(u.id);
    const openReports = (await this.store.listReports("OPEN")).length;
    return {
      userCount: users.length,
      suspendedCount: users.filter((u) => u.status === "SUSPENDED").length,
      liveRoomCount: this.rooms.listAllRooms().length,
      openReports,
      chipsInCirculation,
    };
  }
}
