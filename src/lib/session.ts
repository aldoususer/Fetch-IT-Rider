// Session helper — minimal cookie-based token (no external JWT dep needed).
// For production on Vercel, swap to NextAuth or signed JWT; current impl is a
// stateless JSON token signed with a shared secret, suitable for a demo.

import { cookies } from "next/headers";
import type { Role } from "./constants";

const SESSION_COOKIE = "fetchit_session";
const SECRET = process.env.SESSION_SECRET || "fetch-it-dev-secret-please-rotate";

export interface SessionPayload {
  uid: string;
  email: string;
  name: string;
  role: Role;
  exp: number;
}

// --- base64url helpers (no Buffer needed on the edge in Next 16, but works server-side too) ---
function b64encode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
function b64decode<T = unknown>(str: string): T | null {
  try {
    return JSON.parse(Buffer.from(str, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

// Lightweight HMAC-style signature using Node crypto
import crypto from "crypto";
function sign(payloadStr: string): string {
  return crypto.createHmac("sha256", SECRET).update(payloadStr).digest("base64url");
}

export function createSessionToken(payload: Omit<SessionPayload, "exp">): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
  };
  const payloadStr = b64encode(fullPayload);
  const sig = sign(payloadStr);
  return `${payloadStr}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadStr, sig] = parts;
  if (sign(payloadStr) !== sig) return null;
  const payload = b64decode<SessionPayload>(payloadStr);
  if (!payload) return null;
  if (payload.exp < Date.now()) return null;
  return payload;
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
