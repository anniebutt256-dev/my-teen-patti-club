// Auth service — mobile OTP registration/login, unique usernames, signup bonus.

import { newId, type Store, type UserRecord } from "./store";
import { OtpService } from "./otp";
import { WalletService } from "./wallet";
import { signSession } from "./session";
import { hashPassword, verifyPassword } from "./password";

const MOBILE_RE = /^\+[1-9]\d{7,14}$/; // E.164
export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** Owner-controlled admin bootstrap: mobiles listed in the ADMIN_MOBILES
 *  env var (comma-separated, E.164) are promoted to ADMIN at login. There is
 *  deliberately no in-app "make me admin" path. */
export function isAdminMobile(mobileNumber: string): boolean {
  return (process.env.ADMIN_MOBILES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(mobileNumber);
}

export class AuthService {
  private store: Store;
  private otp: OtpService;
  private wallet: WalletService;
  constructor(store: Store, otp: OtpService, wallet: WalletService) {
    this.store = store;
    this.otp = otp;
    this.wallet = wallet;
  }

  async requestOtp(mobileNumber: string) {
    if (!MOBILE_RE.test(mobileNumber)) throw new Error("INVALID_MOBILE");
    return this.otp.requestOtp(mobileNumber);
  }

  async verifyAndLogin(
    mobileNumber: string,
    code: string,
    profile?: { username?: string; displayName?: string },
  ): Promise<{ user: UserRecord; token: string; isNewUser: boolean }> {
    if (!MOBILE_RE.test(mobileNumber)) throw new Error("INVALID_MOBILE");
    const ok = await this.otp.verifyOtp(mobileNumber, code);
    if (!ok) throw new Error("OTP_INVALID");

    let user = await this.store.findUserByMobile(mobileNumber);
    let isNewUser = false;

    if (!user) {
      const username = profile?.username?.trim();
      if (!username || !USERNAME_RE.test(username)) {
        throw new Error("USERNAME_REQUIRED");
      }
      const taken = await this.store.findUserByUsername(username.toLowerCase());
      if (taken) throw new Error("USERNAME_TAKEN");
      user = {
        id: newId("user"),
        mobileNumber,
        username,
        displayName: profile?.displayName?.trim() || username,
        avatarUrl: null,
        role: "PLAYER",
        status: "ACTIVE",
        mobileVerified: true,
        passwordHash: null,
        signupBonusGranted: false,
        createdAt: Date.now(),
      };
      await this.store.createUser(user);
      await this.wallet.ensureWallet(user.id);
      isNewUser = true;
    }

    if (isAdminMobile(mobileNumber) && user.role !== "ADMIN") {
      user.role = "ADMIN";
      await this.store.updateUser(user);
    }

    if (user.status === "SUSPENDED") throw new Error("ACCOUNT_SUSPENDED");
    if (!user.mobileVerified) {
      user.mobileVerified = true;
      await this.store.updateUser(user);
    }

    // 10,000 free chips exactly once — safe on every login (idempotent).
    const bonus = await this.wallet.grantSignupBonusOnce(user.id);
    if (bonus && !user.signupBonusGranted) {
      user.signupBonusGranted = true;
      await this.store.updateUser(user);
    }

    return { user, token: signSession(user.id), isNewUser };
  }

  private bootstrapDone = false;

  /** One-time owner bootstrap for the free launch: with no SMS provider,
   *  the owner cannot OTP-login in production, and the first admin account
   *  cannot be created from an empty dashboard. If OWNER_USERNAME and
   *  OWNER_PASSWORD are set in the server environment and NO user exists
   *  yet, the owner's first password-login attempt with exactly those
   *  credentials creates their ADMIN account (with the signup bonus).
   *  It can only ever fire on a completely empty user table. */
  private async maybeBootstrapOwner(username: string, password: string) {
    if (this.bootstrapDone) return;
    const ownerName = (process.env.OWNER_USERNAME ?? "").trim();
    const ownerPass = process.env.OWNER_PASSWORD ?? "";
    if (!ownerName || !ownerPass || !USERNAME_RE.test(ownerName)) {
      this.bootstrapDone = true;
      return;
    }
    if (username.trim().toLowerCase() !== ownerName.toLowerCase()) return;
    const anyUsers = await this.store.listUsers("", 1);
    if (anyUsers.length > 0) {
      this.bootstrapDone = true;
      return;
    }
    if (password !== ownerPass) return; // wrong password: no creation, generic refusal below
    const user: UserRecord = {
      id: newId("user"),
      mobileNumber: `manual:${ownerName.toLowerCase()}`,
      username: ownerName,
      displayName: ownerName,
      avatarUrl: null,
      role: "ADMIN",
      status: "ACTIVE",
      mobileVerified: false,
      passwordHash: hashPassword(ownerPass),
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
    this.bootstrapDone = true;
  }

  /** Username + password login — the path for owner-created accounts
   *  (friends the owner added from the admin dashboard, no SMS involved).
   *  One generic error for unknown user / no password set / wrong password,
   *  so the response never reveals which usernames exist. */
  async loginWithPassword(
    username: string,
    password: string,
  ): Promise<{ user: UserRecord; token: string }> {
    const name = (username ?? "").trim();
    await this.maybeBootstrapOwner(name, password ?? "");
    const user = name ? await this.store.findUserByUsername(name.toLowerCase()) : null;
    if (!user || !user.passwordHash || !verifyPassword(password ?? "", user.passwordHash)) {
      throw new Error("INVALID_CREDENTIALS");
    }
    if (user.status === "SUSPENDED") throw new Error("ACCOUNT_SUSPENDED");
    // Same exactly-once bonus guarantee as OTP login (already granted at
    // creation for manual accounts; this keeps the invariant in one place).
    const bonus = await this.wallet.grantSignupBonusOnce(user.id);
    if (bonus && !user.signupBonusGranted) {
      user.signupBonusGranted = true;
      await this.store.updateUser(user);
    }
    return { user, token: signSession(user.id) };
  }
}
