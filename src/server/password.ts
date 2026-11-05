// Password hashing for username+password login (owner-created accounts).
// Same construction as room passwords: scrypt (Node's built-in KDF) with a
// per-password salt, stored as "salt:hash". Plaintext never persists.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const candidate = scryptSync(password, salt, 32);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function assertPasswordStrength(password: string) {
  if (typeof password !== "string" || password.length < 6 || password.length > 64) {
    throw new Error("PASSWORD_WEAK");
  }
}
