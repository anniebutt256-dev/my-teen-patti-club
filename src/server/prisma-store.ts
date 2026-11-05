// Production store — Prisma/PostgreSQL implementation of the Store contract.
// Used only when DATABASE_URL is set (see services.ts). Wallet movements that
// must be atomic run through WalletService logic here in dev parity; the
// production round-settlement path wraps applyMovement in a serializable
// prisma.$transaction (Phase 3 settlement work builds on this class).

import { PrismaClient } from "@prisma/client";
import type {
  AuditRecord,
  ChipTxRecord,
  OtpRecord,
  ReportRecord,
  Store,
  UserRecord,
  WalletRecord,
} from "./store";

const prisma = new PrismaClient();

const toUser = (u: {
  id: string;
  mobileNumber: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: "PLAYER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  mobileVerified: boolean;
  passwordHash: string | null;
  signupBonusGranted: boolean;
  createdAt: Date;
}): UserRecord => ({ ...u, createdAt: u.createdAt.getTime() });

export class PrismaStore implements Store {
  // users
  async findUserById(id: string) {
    const u = await prisma.user.findUnique({ where: { id } });
    return u ? toUser(u) : null;
  }
  async listUsers(search = "", limit = 100) {
    const q = search.trim();
    const rows = await prisma.user.findMany({
      where: q
        ? {
            OR: [
              { username: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } },
              { mobileNumber: { contains: q } },
            ],
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toUser);
  }
  async findUserByMobile(mobile: string) {
    const u = await prisma.user.findUnique({ where: { mobileNumber: mobile } });
    return u ? toUser(u) : null;
  }
  async findUserByUsername(usernameLower: string) {
    const u = await prisma.user.findFirst({
      where: { username: { equals: usernameLower, mode: "insensitive" } },
    });
    return u ? toUser(u) : null;
  }
  async createUser(u: UserRecord) {
    const created = await prisma.user.create({
      data: {
        id: u.id,
        mobileNumber: u.mobileNumber,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        role: u.role,
        status: u.status,
        mobileVerified: u.mobileVerified,
        passwordHash: u.passwordHash,
        signupBonusGranted: u.signupBonusGranted,
      },
    });
    return toUser(created);
  }
  async updateUser(u: UserRecord) {
    await prisma.user.update({
      where: { id: u.id },
      data: {
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        role: u.role,
        status: u.status,
        mobileVerified: u.mobileVerified,
        passwordHash: u.passwordHash,
        signupBonusGranted: u.signupBonusGranted,
      },
    });
  }
  // otps
  async createOtp(o: OtpRecord) {
    await prisma.otpCode.create({
      data: {
        id: o.id,
        mobileNumber: o.mobileNumber,
        codeHash: o.codeHash,
        salt: o.salt,
        attempts: o.attempts,
        maxAttempts: o.maxAttempts,
        expiresAt: new Date(o.expiresAt),
        consumedAt: o.consumedAt ? new Date(o.consumedAt) : null,
      },
    });
  }
  async findLatestOtp(mobile: string) {
    const o = await prisma.otpCode.findFirst({
      where: { mobileNumber: mobile, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!o) return null;
    return {
      id: o.id,
      mobileNumber: o.mobileNumber,
      codeHash: o.codeHash,
      salt: o.salt,
      attempts: o.attempts,
      maxAttempts: o.maxAttempts,
      expiresAt: o.expiresAt.getTime(),
      consumedAt: o.consumedAt ? o.consumedAt.getTime() : null,
      createdAt: o.createdAt.getTime(),
    };
  }
  async updateOtp(o: OtpRecord) {
    await prisma.otpCode.update({
      where: { id: o.id },
      data: {
        attempts: o.attempts,
        consumedAt: o.consumedAt ? new Date(o.consumedAt) : null,
      },
    });
  }
  async countOtpsSince(mobile: string, sinceMs: number) {
    return prisma.otpCode.count({
      where: { mobileNumber: mobile, createdAt: { gte: new Date(sinceMs) } },
    });
  }
  // wallet + ledger
  async getWallet(userId: string): Promise<WalletRecord | null> {
    const w = await prisma.wallet.findUnique({ where: { userId } });
    return w ? { userId: w.userId, balance: w.balance } : null;
  }
  async createWallet(w: WalletRecord) {
    await prisma.wallet.create({ data: { userId: w.userId, balance: w.balance } });
  }
  async setWalletBalance(userId: string, balance: number) {
    await prisma.wallet.update({ where: { userId }, data: { balance } });
  }
  async findTxByKey(key: string) {
    const t = await prisma.chipTransaction.findUnique({
      where: { idempotencyKey: key },
    });
    if (!t) return null;
    return {
      id: t.id,
      userId: t.userId,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      roundId: t.roundId,
      idempotencyKey: t.idempotencyKey,
      note: t.note,
      createdAt: t.createdAt.getTime(),
    };
  }
  async createTx(t: ChipTxRecord) {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: t.userId },
    });
    if (!wallet) throw new Error("WALLET_NOT_FOUND");
    await prisma.chipTransaction.create({
      data: {
        id: t.id,
        userId: t.userId,
        walletId: wallet.id,
        // Ledger types are constrained by the ChipTxType enum in the schema.
        type: t.type as never,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        roundId: t.roundId,
        idempotencyKey: t.idempotencyKey,
        note: t.note,
      },
    });
  }
  async listTx(userId: string, limit: number) {
    const rows = await prisma.chipTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(
      (t: {
        id: string;
        userId: string;
        type: string;
        amount: number;
        balanceAfter: number;
        roundId: string | null;
        idempotencyKey: string;
        note: string | null;
        createdAt: Date;
      }) => ({
      id: t.id,
      userId: t.userId,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      roundId: t.roundId,
      idempotencyKey: t.idempotencyKey,
      note: t.note,
      createdAt: t.createdAt.getTime(),
    }));
  }
  // reports + admin audit (Phase 5)
  async createReport(r: ReportRecord) {
    await prisma.report.create({
      data: {
        id: r.id,
        reporterId: r.reporterId,
        targetId: r.targetId,
        roomId: r.roomId,
        reason: r.reason,
        status: r.status as never,
        reviewedAt: r.reviewedAt ? new Date(r.reviewedAt) : null,
      },
    });
  }
  async listReports(status?: string) {
    const rows = await prisma.report.findMany({
      where: status ? { status: status as never } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(
      (r: {
        id: string;
        reporterId: string;
        targetId: string | null;
        roomId: string | null;
        reason: string;
        status: string;
        createdAt: Date;
        reviewedAt: Date | null;
      }) => ({
        id: r.id,
        reporterId: r.reporterId,
        targetId: r.targetId,
        roomId: r.roomId,
        reason: r.reason,
        status: r.status as ReportRecord["status"],
        createdAt: r.createdAt.getTime(),
        reviewedAt: r.reviewedAt ? r.reviewedAt.getTime() : null,
      }),
    );
  }
  async updateReport(r: ReportRecord) {
    await prisma.report.update({
      where: { id: r.id },
      data: {
        status: r.status as never,
        reviewedAt: r.reviewedAt ? new Date(r.reviewedAt) : null,
      },
    });
  }
  async createAudit(a: AuditRecord) {
    await prisma.adminAuditLog.create({
      data: {
        id: a.id,
        adminId: a.adminId,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        reason: a.reason,
        meta: a.meta ? JSON.parse(a.meta) : undefined,
      },
    });
  }
  async listAudit(limit: number) {
    const rows = await prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(
      (a: {
        id: string;
        adminId: string;
        action: string;
        targetType: string;
        targetId: string;
        reason: string | null;
        meta: unknown;
        createdAt: Date;
      }) => ({
        id: a.id,
        adminId: a.adminId,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        reason: a.reason,
        meta: a.meta ? JSON.stringify(a.meta) : null,
        createdAt: a.createdAt.getTime(),
      }),
    );
  }
}
