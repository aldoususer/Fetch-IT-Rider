// POST /api/auth/login
// Body: { email, password, role? } — role is optional but recommended; if provided,
// we verify that the account's role matches to prevent customer-as-rider logins.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSessionToken, setSessionCookie } from "@/lib/session";
import type { Role } from "@/lib/constants";

export async function POST(req: NextRequest) {
  try {
    const { email, password, role } = (await req.json()) as {
      email: string;
      password: string;
      role?: Role;
    };
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 },
      );
    }
    const user = await db.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
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
    if (role && user.role !== role) {
      return NextResponse.json(
        {
          error: `This account is registered as ${user.role.toLowerCase()}, not ${role.toLowerCase()}.`,
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
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        vehicleClass: user.vehicleClass,
        vehiclePlate: user.vehiclePlate,
        rating: user.rating,
        totalDeliveries: user.totalDeliveries,
        isOnline: user.isOnline,
      },
    });
  } catch (err) {
    console.error("[login] error", err);
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}
