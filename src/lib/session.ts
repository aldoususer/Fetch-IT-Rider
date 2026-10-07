import { sessionSecret } from "./session-secret";
// Session helper — minimal cookie-based token (no external JWT dep needed).
// For production on Vercel, swap to NextAuth or signed JWT; current impl is a
// stateless JSON token signed with a shared secret, suitable for a demo.

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { Role } from "./constants";

const SESSION_COOKIE = "fetchit_session";

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
  return crypto.createHmac("sha256", sessionSecret("SESSION_SECRET")).update(payloadStr).digest("base64url");
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
  const expected = Buffer.from(sign(payloadStr));
  const received = Buffer.from(sig);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  const payload = b64decode<SessionPayload>(payloadStr);
  if (!payload || typeof payload.uid !== "string" || !payload.uid || typeof payload.email !== "string" || typeof payload.name !== "string" || !Number.isFinite(payload.exp) || payload.exp < Date.now() || !["CUSTOMER", "RIDER", "ADMIN"].includes(payload.role)) return null;
  return payload;
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Authenticate native clients with the same signed token used by the web
 * session. Native apps cannot rely on browser cookies, so they send
 * `Authorization: Bearer <token>` over HTTPS instead. */
export function getBearerSession(req: NextRequest): SessionPayload | null {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return verifySessionToken(authorization.slice(7).trim());
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
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
