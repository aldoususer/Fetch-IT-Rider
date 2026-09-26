import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getBearerSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const session = getBearerSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "RIDER") {
    return NextResponse.json({ error: "Rider account required." }, { status: 403 });
  }

  const user = await db.user.findUnique({
    where: { id: session.uid },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      vehicleClass: true,
      vehiclePlate: true,
      rating: true,
      totalDeliveries: true,
      isOnline: true,
    },
  });
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  return NextResponse.json({ user });
}
