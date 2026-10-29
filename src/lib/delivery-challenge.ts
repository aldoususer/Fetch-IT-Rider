import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

// Used for ride pickup verification. Keep the legacy helper/table/secret names
// so existing deployments can use the shared challenge store without migration.

export const CHALLENGE_TTL_MS = 15 * 60 * 1000;
export const MAX_CHALLENGE_ATTEMPTS = 5;

function key() {
  const secret = process.env.DELIVERY_CODE_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error("Configure the shared DELIVERY_CODE_SECRET or SESSION_SECRET for ride pickup codes.");
  return createHash("sha256").update(`fetch-delivery-code:${secret}`).digest();
}
export function challengeHash(bookingId: string, code: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(`${bookingId}:${code}`, salt, 32).toString("hex");
  return `scrypt-v2:${salt}:${hash}`;
}
export function isPortableChallenge(hash: string) { return /^scrypt-v2:[a-f0-9]{32}:[a-f0-9]{64}$/.test(hash); }
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
  if (!/^\d{6}$/.test(code)) return false;
  // Only the Customer app decrypts the code. Its salted verifier is portable
  // across apps with different session/encryption secrets, and booking-bound.
  if (isPortableChallenge(expected)) {
    const [, salt, hash] = expected.split(":");
    const actual = scryptSync(`${bookingId}:${code}`, salt, 32);
    return timingSafeEqual(actual, Buffer.from(hash, "hex"));
  }
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  // Legacy codes remain valid during rolling deployments when secrets match.
  const actual = createHmac("sha256", key()).update(`${bookingId}:${code}`).digest();
  const saved = Buffer.from(expected, "hex");
  return actual.length === saved.length && timingSafeEqual(actual, saved);
}
