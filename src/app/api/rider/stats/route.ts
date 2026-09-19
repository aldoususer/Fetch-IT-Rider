// GET /api/rider/stats
// Aggregated stats for the rider dashboard header.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "RIDER") {
    return NextResponse.json(
      { error: "Only riders can fetch rider stats." },
      { status: 403 },
    );
  }

  const active = await db.booking.count({
    where: { riderId: session.uid, status: { in: ["MATCHED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"] } },
  });
  const delivered = await db.booking.count({
    where: { riderId: session.uid, status: "DELIVERED" },
  });
  const available = await db.booking.count({
    where: { status: "PENDING" },
  });

  const rider = await db.user.findUnique({ where: { id: session.uid } });
  const earningsResult = await db.booking.aggregate({
    where: { riderId: session.uid, status: "DELIVERED" },
    _sum: { totalFare: true },
  });

  return NextResponse.json({
    activeJobs: active,
    completedJobs: delivered,
    availableJobs: available,
    rating: rider?.rating ?? 5.0,
    totalDeliveries: rider?.totalDeliveries ?? 0,
    isOnline: rider?.isOnline ?? false,
    earnings: earningsResult._sum.totalFare ?? 0,
    vehicleClass: rider?.vehicleClass,
    vehiclePlate: rider?.vehiclePlate,
  });
}
