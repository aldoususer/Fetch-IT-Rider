// Password hashing utilities — uses Node's built-in scrypt (no external deps).
import crypto from "crypto";

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto
    .scryptSync(plain, salt, 64)
    .toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const [salt, derived] = stored.split(":");
    const test = crypto.scryptSync(plain, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(test), Buffer.from(derived));
  } catch {
    return false;
  }
}
