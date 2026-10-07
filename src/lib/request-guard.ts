import { createHmac, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "./db";
import { sessionSecret } from "./session-secret";

export class RateLimitError extends Error {
  constructor(public retryAfter: number) { super("Too many requests. Please wait before trying again."); }
}

export function clientAddress(request: NextRequest) {
  // Vercel overwrites this header. On other hosts, do not trust caller-supplied
  // forwarding headers without an explicitly configured trusted reverse proxy.
  return process.env.VERCEL === "1" ? request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown" : "local";
}

export async function limitRequests(scope: string, subject: string, max: number, windowMs: number) {
  const secret = sessionSecret(process.env.ADMIN_SESSION_SECRET ? "ADMIN_SESSION_SECRET" : "SESSION_SECRET");
  const key = createHmac("sha256", secret).update(JSON.stringify([scope, subject])).digest("hex");
  const rows = await db.$queryRaw<{ hits: number; retryAfter: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "hits", "expiresAt")
    VALUES (${key}, 1, CURRENT_TIMESTAMP + ${windowMs} * INTERVAL '1 millisecond')
    ON CONFLICT ("key") DO UPDATE SET
      "hits" = CASE WHEN "RateLimitBucket"."expiresAt" <= CURRENT_TIMESTAMP THEN 1 ELSE LEAST("RateLimitBucket"."hits" + 1, ${max + 1}) END,
      "expiresAt" = CASE WHEN "RateLimitBucket"."expiresAt" <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + ${windowMs} * INTERVAL '1 millisecond' ELSE "RateLimitBucket"."expiresAt" END
    RETURNING "hits", GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("expiresAt" - CURRENT_TIMESTAMP)))::integer) AS "retryAfter";
  `;
  if (rows[0].hits > max) throw new RateLimitError(rows[0].retryAfter);
}

export async function limitLogin(request: NextRequest, app: string, email: string) {
  await limitRequests(`${app}:login-ip`, clientAddress(request), 120, 15 * 60_000);
  await limitRequests(`${app}:login-account`, email.trim().toLowerCase().slice(0, 254), 15, 15 * 60_000);
}

export async function cleanupRateLimits() {
  return db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" IN (SELECT "key" FROM "RateLimitBucket" WHERE "expiresAt" < CURRENT_TIMESTAMP LIMIT 5000)`;
}

export function safeErrorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_/-]{1,60}$/.test(code) ? code : "INTERNAL";
}

export function withRequestLog<Args extends [NextRequest, ...unknown[]]>(scope: string, handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args) => {
    const requestId = randomUUID();
    const started = Date.now();
    let response: Response;
    let code: string | undefined;
    try { response = await handler(...args); }
    catch (error) {
      if (error instanceof RateLimitError) {
        response = NextResponse.json({ error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfter) } });
      } else {
        code = safeErrorCode(error);
        response = NextResponse.json({ error: "This service is temporarily unavailable. Please try again." }, { status: 503 });
      }
    }
    response.headers.set("X-Request-ID", requestId);
    response.headers.set("Cache-Control", "private, no-store");
    if (args[0].method !== "GET" || response.status >= 400) console.info(JSON.stringify({ requestId, operation: scope, method: args[0].method, status: response.status, durationMs: Date.now() - started, ...(code || response.status >= 500 ? { code: code || "INTERNAL" } : {}) }));
    return response;
  };
}
