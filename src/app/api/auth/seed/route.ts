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
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ENABLE_DEMO_SEED !== "true") {
    return NextResponse.json({ error: "Demo accounts are disabled." }, { status: 403 });
  }
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
        authIdentities: { create: { provider: "PASSWORD", providerUserId: customerEmail, passwordHash: DEMO_PASSWORD } },

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
        authIdentities: { create: { provider: "PASSWORD", providerUserId: riderEmail, passwordHash: DEMO_PASSWORD } },

        role: "RIDER",
        phone: "+1 555 0101",
        riderProfile: { create: { vehicleClass: "CLOSED_VAN", vehiclePlate: "FIT-2099" } },
        riderPresence: { create: { isOnline: true } },
      },
    });

    // Add a second rider for the matching engine to have options.
    await db.user.upsert({
      where: { email: "rider2@fetchit.app" },
      update: {},
      create: {
        name: "Priya Singh",
        email: "rider2@fetchit.app",
        authIdentities: { create: { provider: "PASSWORD", providerUserId: "rider2@fetchit.app", passwordHash: DEMO_PASSWORD } },

        role: "RIDER",
        phone: "+1 555 0102",
        riderProfile: { create: { vehicleClass: "MOTORCYCLE", vehiclePlate: "FIT-3140" } },
        riderPresence: { create: { isOnline: true } },
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
