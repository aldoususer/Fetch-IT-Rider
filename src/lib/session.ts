import { sessionSecret } from "./session-secret";
import { db } from "./db";
// Signed sessions retain their authentication time so password resets can
// invalidate both browser cookies and native bearer sessions.

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
  iat?: number;
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
    iat: payload.iat ?? Date.now(),
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
  if (!payload || typeof payload.uid !== "string" || !payload.uid || typeof payload.email !== "string" || typeof payload.name !== "string" || !Number.isFinite(payload.exp) || payload.exp < Date.now() || (payload.iat !== undefined && (!Number.isFinite(payload.iat) || payload.iat < 0)) || !["CUSTOMER", "RIDER", "ADMIN"].includes(payload.role)) return null;
  return payload;
}

export function isSessionCurrent(session: SessionPayload, user: { role: string; isBanned: boolean; authInvalidBefore: Date | null } | null): boolean {
  return !!user && !user.isBanned && user.role === session.role
    && (!user.authInvalidBefore || (session.iat !== undefined && session.iat > user.authInvalidBefore.getTime()));
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = verifySessionToken(token);
  if (!session) return null;
  const user = await db.user.findUnique({ where: { id: session.uid }, select: { role: true, isBanned: true, authInvalidBefore: true } });
  return isSessionCurrent(session, user) ? session : null;
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
