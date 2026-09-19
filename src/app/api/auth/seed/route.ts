// POST /api/auth/seed
// Idempotent endpoint that creates demo accounts so the user can try the
// product without setting up an email/password manually.
//   • customer@fetchit.app   / demo1234   (role: CUSTOMER)
//   • rider@fetchit.app      / demo1234   (role: RIDER, CLOSED_VAN)
// On success, returns both demo credentials so the UI can show them.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export async function POST() {
  try {
    const DEMO_PASSWORD = hashPassword("demo1234");

    const customerEmail = "customer@fetchit.app";
    const riderEmail = "rider@fetchit.app";

    await db.user.upsert({
      where: { email: customerEmail },
      update: {},
      create: {
        name: "Avery Chen",
        email: customerEmail,
        passwordHash: DEMO_PASSWORD,
        role: "CUSTOMER",
        phone: "+1 555 0100",
      },
    });

    await db.user.upsert({
      where: { email: riderEmail },
      update: {},
      create: {
        name: "Marcus Rivera",
        email: riderEmail,
        passwordHash: DEMO_PASSWORD,
        role: "RIDER",
        phone: "+1 555 0101",
        vehicleClass: "CLOSED_VAN",
        vehiclePlate: "FIT-2099",
        isOnline: true,
        lat: 1.3521,
        lng: 103.8198,
        locationAt: new Date(),
      },
    });

    // Add a second rider for the matching engine to have options.
    await db.user.upsert({
      where: { email: "rider2@fetchit.app" },
      update: {},
      create: {
        name: "Priya Singh",
        email: "rider2@fetchit.app",
        passwordHash: DEMO_PASSWORD,
        role: "RIDER",
        phone: "+1 555 0102",
        vehicleClass: "MOTORCYCLE",
        vehiclePlate: "FIT-3140",
        isOnline: true,
        lat: 1.3450,
        lng: 103.8120,
        locationAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      accounts: [
        { email: customerEmail, password: "demo1234", role: "CUSTOMER" },
        { email: riderEmail, password: "demo1234", role: "RIDER" },
      ],
    });
  } catch (err) {
    console.error("[seed] error", err);
    return NextResponse.json(
      { error: "Failed to seed demo accounts." },
      { status: 500 },
    );
  }
}
