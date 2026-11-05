// OTP service — hashed codes only, expiry, attempt cap, per-number rate limit.
// The SMS sender is an interface: production wires a real SMS provider;
// dev/tests use a local sender. Plaintext codes are never stored or logged.

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { newId, type OtpRecord, type Store } from "./store";

export interface SmsSender {
  send(mobileNumber: string, code: string): Promise<void>;
}

/** Dev-only sender: keeps the code in memory so local flows/tests can run
 *  without an SMS provider. Never used in production wiring. */
export class DevSmsSender implements SmsSender {
  lastCode = new Map<string, string>();
  async send(mobileNumber: string, code: string) {
    this.lastCode.set(mobileNumber, code);
  }
}

export function hashOtp(code: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

export interface OtpOptions {
  ttlMs?: number;
  maxAttempts?: number;
  maxRequestsPerWindow?: number;
  windowMs?: number;
  now?: () => number;
}

export class OtpService {
  private store: Store;
  private sms: SmsSender;
  private ttlMs: number;
  private maxAttempts: number;
  private maxRequestsPerWindow: number;
  private windowMs: number;
  private now: () => number;

  constructor(store: Store, sms: SmsSender, opts: OtpOptions = {}) {
    this.store = store;
    this.sms = sms;
    this.ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.maxRequestsPerWindow = opts.maxRequestsPerWindow ?? 5;
    this.windowMs = opts.windowMs ?? 10 * 60 * 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  async requestOtp(mobileNumber: string): Promise<{ expiresAt: number }> {
    const now = this.now();
    const recent = await this.store.countOtpsSince(
      mobileNumber,
      now - this.windowMs,
    );
    if (recent >= this.maxRequestsPerWindow) {
      throw new Error("OTP_RATE_LIMITED");
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const salt = randomBytes(16).toString("hex");
    const rec: OtpRecord = {
      id: newId("otp"),
      mobileNumber,
      codeHash: hashOtp(code, salt),
      salt,
      attempts: 0,
      maxAttempts: this.maxAttempts,
      expiresAt: now + this.ttlMs,
      consumedAt: null,
      createdAt: now,
    };
    await this.store.createOtp(rec);
    await this.sms.send(mobileNumber, code);
    return { expiresAt: rec.expiresAt };
  }

  async verifyOtp(mobileNumber: string, code: string): Promise<boolean> {
    const rec = await this.store.findLatestOtp(mobileNumber);
    if (!rec) return false;
    const now = this.now();
    if (rec.expiresAt < now) return false;
    if (rec.attempts >= rec.maxAttempts) return false;

    const candidate = Buffer.from(hashOtp(code, rec.salt), "hex");
    const expected = Buffer.from(rec.codeHash, "hex");
    const ok =
      candidate.length === expected.length && timingSafeEqual(candidate, expected);

    if (!ok) {
      rec.attempts += 1;
      await this.store.updateOtp(rec);
      return false;
    }
    rec.consumedAt = now;
    await this.store.updateOtp(rec);
    return true;
  }
}
