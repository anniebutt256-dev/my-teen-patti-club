// Wallet service — virtual chips only.
// Every movement is an append-only ledger row; the balance is a result of the
// ledger, never edited silently. Movements carry an idempotency key: a replayed
// game action can never double-debit or double-credit. In production the same
// operations run inside a serializable Prisma transaction (prisma-store.ts).

import { newId, type ChipTxRecord, type Store } from "./store";

export const SIGNUP_BONUS = 10_000;

export class WalletService {
  private store: Store;
  constructor(store: Store) {
    this.store = store;
  }

  async ensureWallet(userId: string): Promise<number> {
    const w = await this.store.getWallet(userId);
    if (w) return w.balance;
    await this.store.createWallet({ userId, balance: 0 });
    return 0;
  }

  async getBalance(userId: string): Promise<number> {
    const w = await this.store.getWallet(userId);
    return w?.balance ?? 0;
  }

  async applyMovement(
    userId: string,
    type: string,
    amount: number,
    idempotencyKey: string,
    note?: string,
    roundId?: string,
  ): Promise<ChipTxRecord> {
    const existing = await this.store.findTxByKey(idempotencyKey);
    if (existing) return existing; // idempotent replay — no double posting

    await this.ensureWallet(userId);
    const balance = await this.getBalance(userId);
    const balanceAfter = balance + amount;
    if (balanceAfter < 0) throw new Error("INSUFFICIENT_CHIPS");

    const tx: ChipTxRecord = {
      id: newId("tx"),
      userId,
      type,
      amount,
      balanceAfter,
      roundId: roundId ?? null,
      idempotencyKey,
      note: note ?? null,
      createdAt: Date.now(),
    };
    await this.store.createTx(tx);
    await this.store.setWalletBalance(userId, balanceAfter);
    return tx;
  }

  /** 10,000 free chips exactly once per verified account. */
  async grantSignupBonusOnce(userId: string): Promise<ChipTxRecord | null> {
    const key = `signup-bonus:${userId}`;
    const existing = await this.store.findTxByKey(key);
    if (existing) return null;
    return this.applyMovement(
      userId,
      "SIGNUP_BONUS",
      SIGNUP_BONUS,
      key,
      "Welcome bonus — 10,000 free virtual chips",
    );
  }

  async history(userId: string, limit = 20): Promise<ChipTxRecord[]> {
    return this.store.listTx(userId, limit);
  }
}
