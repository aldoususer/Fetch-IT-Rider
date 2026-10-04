import { publicUser } from "@/lib/db-data";
// POST /api/auth/signup
// Body: { name, email, password, role, phone?, vehicleClass?, vehiclePlate? }
// Creates a new user and issues a session cookie.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSessionToken, setSessionCookie } from "@/lib/session";
import { VEHICLES, type Role, type VehicleClass } from "@/lib/constants";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, password, role, phone, vehicleClass, vehiclePlate } =
      body as {
        name: string;
        email: string;
        password: string;
        role: Role;
        phone?: string;
        vehicleClass?: VehicleClass;
        vehiclePlate?: string;
      };

    if (
      typeof name !== "string" || !name.trim() || name.length > 80 ||
      typeof email !== "string" || !email.trim() || email.length > 254 ||
      typeof password !== "string" || !password ||
      !role ||
      role !== "RIDER"
    ) {
      return NextResponse.json(
        { error: "Missing or invalid fields." },
        { status: 400 },
      );
    }
    if (password.length < 4) {
      return NextResponse.json(
        { error: "Password must be at least 4 characters." },
        { status: 400 },
      );
    }
    if (role === "RIDER" && (!vehicleClass || !Object.hasOwn(VEHICLES, vehicleClass))) {
      return NextResponse.json(
        { error: "Riders must specify a vehicle class." },
        { status: 400 },
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return NextResponse.json(
        { error: "Email is already registered." },
        { status: 409 },
      );
    }

    const user = await db.user.create({
      data: {
        name,
        email: normalizedEmail,
        phone,
        role,
        authIdentities: { create: { provider: "PASSWORD", providerUserId: normalizedEmail, passwordHash: hashPassword(password) } },
        riderProfile: { create: { vehicleClass: vehicleClass!, vehiclePlate: vehiclePlate ?? null } },
        riderPresence: { create: {} },
      },
      include: { riderProfile: true, riderPresence: true },
    });

    const token = createSessionToken({
      uid: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
    });
    await setSessionCookie(token);

    return NextResponse.json({
      user: publicUser(user),
    });
  } catch (err) {
    console.error("[signup] error", err);
    return NextResponse.json(
      { error: "Failed to create account." },
      { status: 500 },
    );
  }
}
