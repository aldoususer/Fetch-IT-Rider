// POST /api/auth/logout — clears the session cookie.
import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export async function POST() {
  const deviceId = (await cookies()).get("fetchit_rider_push_device")?.value;
  // Cookie is HttpOnly and unguessable. Revoke this installation even when
  // the login session has expired, before permitting an account switch.
  if (deviceId) await db.customerPushSubscription.deleteMany({ where: { deviceId } });
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
