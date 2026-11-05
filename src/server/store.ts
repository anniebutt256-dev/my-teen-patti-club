// MY TEEN PATTI CLUB — data access contract.
// Auth/wallet/room services depend on this interface only.
// InMemoryStore powers local dev + automated tests; PrismaStore (prisma-store.ts)
// is the production implementation against PostgreSQL.

export interface UserRecord {
  id: string;
  mobileNumber: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: "PLAYER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  mobileVerified: boolean;
  passwordHash: string | null; // scrypt "salt:hash" for password login; null = OTP-only account
  signupBonusGranted: boolean;
  createdAt: number;
}

export interface OtpRecord {
  id: string;
  mobileNumber: string;
  codeHash: string;
  salt: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: number; // epoch ms
  consumedAt: number | null;
  createdAt: number;
}

export interface WalletRecord {
  userId: string;
  balance: number;
}

export interface ChipTxRecord {
  id: string;
  userId: string;
  type: string;
  amount: number; // signed
  balanceAfter: number;
  roundId: string | null;
  idempotencyKey: string;
  note: string | null;
  createdAt: number;
}

export interface ReportRecord {
  id: string;
  reporterId: string;
  targetId: string | null;
  roomId: string | null;
  reason: string;
  status: "OPEN" | "REVIEWED" | "DISMISSED";
  createdAt: number;
  reviewedAt: number | null; // who reviewed is in the audit log (REPORT_REVIEW)
}

export interface AuditRecord {
  id: string;
  adminId: string;
  action: string; // USER_SUSPEND | USER_ACTIVATE | CHIP_GRANT | CHIP_DEDUCT | ROOM_CLOSE | REPORT_REVIEW
  targetType: string; // USER | ROOM | REPORT
  targetId: string;
  reason: string | null;
  meta: string | null; // JSON string
  createdAt: number;
}

export interface Store {
  // users
  findUserById(id: string): Promise<UserRecord | null>;
  listUsers(search?: string, limit?: number): Promise<UserRecord[]>;
  findUserByMobile(mobile: string): Promise<UserRecord | null>;
  findUserByUsername(usernameLower: string): Promise<UserRecord | null>;
  createUser(u: UserRecord): Promise<UserRecord>;
  updateUser(u: UserRecord): Promise<void>;
  // otps
  createOtp(o: OtpRecord): Promise<void>;
  findLatestOtp(mobile: string): Promise<OtpRecord | null>;
  updateOtp(o: OtpRecord): Promise<void>;
  countOtpsSince(mobile: string, sinceMs: number): Promise<number>;
  // wallet + ledger
  getWallet(userId: string): Promise<WalletRecord | null>;
  createWallet(w: WalletRecord): Promise<void>;
  setWalletBalance(userId: string, balance: number): Promise<void>;
  findTxByKey(key: string): Promise<ChipTxRecord | null>;
  createTx(t: ChipTxRecord): Promise<void>;
  listTx(userId: string, limit: number): Promise<ChipTxRecord[]>;
  // reports + admin audit (Phase 5)
  createReport(r: ReportRecord): Promise<void>;
  listReports(status?: string): Promise<ReportRecord[]>;
  updateReport(r: ReportRecord): Promise<void>;
  createAudit(a: AuditRecord): Promise<void>;
  listAudit(limit: number): Promise<AuditRecord[]>;
}

let seq = 0;
export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${(++seq).toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

export class InMemoryStore implements Store {
  users = new Map<string, UserRecord>();
  otps: OtpRecord[] = [];
  wallets = new Map<string, WalletRecord>();
  txs: ChipTxRecord[] = [];
  reports: ReportRecord[] = [];
  audits: AuditRecord[] = [];

  async findUserById(id: string) {
    return this.users.get(id) ?? null;
  }
  async listUsers(search = "", limit = 100) {
    const q = search.trim().toLowerCase();
    return [...this.users.values()]
      .filter(
        (u) =>
          !q ||
          u.username.toLowerCase().includes(q) ||
          u.mobileNumber.includes(q) ||
          u.displayName.toLowerCase().includes(q),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
  async findUserByMobile(mobile: string) {
    return [...this.users.values()].find((u) => u.mobileNumber === mobile) ?? null;
  }
  async findUserByUsername(usernameLower: string) {
    return (
      [...this.users.values()].find(
        (u) => u.username.toLowerCase() === usernameLower,
      ) ?? null
    );
  }
  async createUser(u: UserRecord) {
    this.users.set(u.id, u);
    return u;
  }
  async updateUser(u: UserRecord) {
    this.users.set(u.id, u);
  }
  async createOtp(o: OtpRecord) {
    this.otps.push(o);
  }
  async findLatestOtp(mobile: string) {
    const list = this.otps
      .filter((o) => o.mobileNumber === mobile && o.consumedAt === null)
      .sort((a, b) => b.createdAt - a.createdAt);
    return list[0] ?? null;
  }
  async updateOtp(o: OtpRecord) {
    const i = this.otps.findIndex((x) => x.id === o.id);
    if (i >= 0) this.otps[i] = o;
  }
  async countOtpsSince(mobile: string, sinceMs: number) {
    return this.otps.filter(
      (o) => o.mobileNumber === mobile && o.createdAt >= sinceMs,
    ).length;
  }
  async getWallet(userId: string) {
    return this.wallets.get(userId) ?? null;
  }
  async createWallet(w: WalletRecord) {
    this.wallets.set(w.userId, w);
  }
  async setWalletBalance(userId: string, balance: number) {
    const w = this.wallets.get(userId);
    if (w) w.balance = balance;
  }
  async findTxByKey(key: string) {
    return this.txs.find((t) => t.idempotencyKey === key) ?? null;
  }
  async createTx(t: ChipTxRecord) {
    this.txs.push(t);
  }
  async listTx(userId: string, limit: number) {
    return this.txs
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
  async createReport(r: ReportRecord) {
    this.reports.push(r);
  }
  async listReports(status?: string) {
    return this.reports
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  async updateReport(r: ReportRecord) {
    const i = this.reports.findIndex((x) => x.id === r.id);
    if (i >= 0) this.reports[i] = r;
  }
  async createAudit(a: AuditRecord) {
    this.audits.push(a);
  }
  async listAudit(limit: number) {
    return [...this.audits]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
}
