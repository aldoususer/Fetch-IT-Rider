// POST /api/auth/signup
// Body: { name, email, password, role, phone?, vehicleClass?, vehiclePlate? }
// Creates a new user and issues a session cookie.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSessionToken, setSessionCookie } from "@/lib/session";
import type { Role, VehicleClass } from "@/lib/constants";

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
      !name ||
      !email ||
      !password ||
      !role ||
      (role !== "CUSTOMER" && role !== "RIDER")
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
    if (role === "RIDER" && !vehicleClass) {
      return NextResponse.json(
        { error: "Riders must specify a vehicle class." },
        { status: 400 },
      );
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "Email is already registered." },
        { status: 409 },
      );
    }

    const user = await db.user.create({
      data: {
        name,
        email,
        phone,
        role,
        passwordHash: hashPassword(password),
        vehicleClass: role === "RIDER" ? vehicleClass : null,
        vehiclePlate: role === "RIDER" ? vehiclePlate ?? null : null,
        lat: role === "RIDER" ? 1.3521 + (Math.random() - 0.5) * 0.1 : null,
        lng: role === "RIDER" ? 103.8198 + (Math.random() - 0.5) * 0.1 : null,
        locationAt: role === "RIDER" ? new Date() : null,
      },
    });

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
      },
    });
  } catch (err) {
    console.error("[signup] error", err);
    return NextResponse.json(
      { error: "Failed to create account." },
      { status: 500 },
    );
  }
}
