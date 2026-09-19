// GET /api/rider/available
// Returns PENDING bookings that match the rider's vehicle class.
// Only meaningful for the RIDER role.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "RIDER") {
    return NextResponse.json(
      { error: "Only riders can view the available jobs feed." },
      { status: 403 },
    );
  }
  const url = new URL(req.url);
  const includeMatched = url.searchParams.get("includeMatched") === "true";

  const rider = await db.user.findUnique({ where: { id: session.uid } });
  if (!rider || !rider.vehicleClass) {
    return NextResponse.json(
      { error: "Rider profile is incomplete (missing vehicle class)." },
      { status: 400 },
    );
  }

  // PENDING jobs are open to any rider of the matching vehicle class.
  // MATCHED jobs are pre-assigned to *this* rider and waiting for acceptance.
  const where = includeMatched
    ? {
        vehicleClass: rider.vehicleClass,
        OR: [
          { status: "PENDING" },
          { status: "MATCHED", riderId: session.uid },
        ],
      }
    : {
        vehicleClass: rider.vehicleClass,
        status: "PENDING" as const,
      };

  const jobs = await db.booking.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: 50,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  return NextResponse.json({ jobs });
}
