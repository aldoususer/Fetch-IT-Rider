import { withRequestLog, RateLimitError, limitLogin, safeErrorCode } from "@/lib/request-guard";
import { publicUser } from "@/lib/db-data";
// POST /api/auth/login
// Body: { email, password, role? } — role is optional but recommended; if provided,
// we verify that the account's role matches to prevent customer-as-rider logins.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSessionToken, setSessionCookie } from "@/lib/session";
import type { Role } from "@/lib/constants";

async function handlePOST(req: NextRequest) {
  try {
    const { email, password, role } = (await req.json()) as {
      email: string;
      password: string;
      role?: Role;
    };
    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || email.length > 254 || !password || password.length > 128) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 },
      );
    }
    if (
      process.env.NODE_ENV === "production" &&
      process.env.NEXT_PUBLIC_ENABLE_DEMO_SEED !== "true" &&
      ["customer@fetchit.app", "rider@fetchit.app", "rider2@fetchit.app"].includes(email.toLowerCase())
    ) {
      return NextResponse.json({ error: "Demo accounts are disabled." }, { status: 403 });
    }
    await limitLogin(req, "rider", String(email));
    const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() }, include: { authIdentities: { where: { provider: "PASSWORD" } }, riderProfile: true, riderPresence: true } });
    if (!user || !user.authIdentities[0]?.passwordHash || !verifyPassword(password, user.authIdentities[0].passwordHash)) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 },
      );
    }
    if (user.isBanned) {
      return NextResponse.json(
        {
          error: user.banReason
            ? `Your account has been restricted: ${user.banReason}`
            : "Your account has been restricted. Contact support for details.",
        },
        { status: 403 },
      );
    }
    if (user.role !== "RIDER" || (role && user.role !== role)) {
      return NextResponse.json(
        {
          error: `This account is registered as ${user.role.toLowerCase()}, not ${(role ?? "RIDER").toLowerCase()}.`,
        },
        { status: 403 },
      );
    }

    const token = createSessionToken({
      uid: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
    });
    await setSessionCookie(token);

    return NextResponse.json({
      // Only the native client receives a bearer token. The PWA keeps the
      // safer HttpOnly-cookie-only response.
      ...(req.headers.get("x-client") === "fetchit-android" ? { token } : {}),
      user: publicUser(user),
    });
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    console.error("[login] error", { code: safeErrorCode(err) });
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}

export const POST = withRequestLog("rider:auth/login:POST", handlePOST);
