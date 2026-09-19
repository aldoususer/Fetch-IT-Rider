// GET /api/auth/me — returns the current logged-in user (or null).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });
  const user = await db.user.findUnique({ where: { id: session.uid } });
  if (!user) return NextResponse.json({ user: null });
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
      lat: user.lat,
      lng: user.lng,
    },
  });
}
