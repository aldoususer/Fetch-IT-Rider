import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const CHALLENGE_TTL_MS = 15 * 60 * 1000;
export const MAX_CHALLENGE_ATTEMPTS = 5;

function key() {
  const secret = process.env.DELIVERY_CODE_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error("Configure DELIVERY_CODE_SECRET or SESSION_SECRET for delivery codes.");
  return createHash("sha256").update(`fetch-delivery-code:${secret}`).digest();
}
export function challengeHash(bookingId: string, code: string) {
  return createHmac("sha256", key()).update(`${bookingId}:${code}`).digest("hex");
}
export function createChallenge(bookingId: string, now = new Date()) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(bookingId));
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return { codeHash: challengeHash(bookingId, code),
    codeCiphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"),
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS), attempts: 0,
    maxAttempts: MAX_CHALLENGE_ATTEMPTS, verifiedAt: null };
}
export function readChallenge(bookingId: string, ciphertext: string) {
  const bytes = Buffer.from(ciphertext, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(bookingId));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}
export function matchesChallenge(bookingId: string, code: string, expected: string) {
  const actual = Buffer.from(challengeHash(bookingId, code), "hex");
  const saved = Buffer.from(expected, "hex");
  return actual.length === saved.length && timingSafeEqual(actual, saved);
}
