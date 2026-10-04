// GET /api/rider/stats
// Aggregated stats for the rider dashboard header.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRiderSession } from "@/lib/rider-access";

export async function GET() {
  const session = await getRiderSession();
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
  const rider = await db.user.findUnique({ where: { id: session.uid }, include: { riderProfile: true, riderPresence: true } });
  const available = rider?.riderPresence?.isOnline && !rider.isBanned && rider.riderProfile?.vehicleClass
    ? await db.booking.count({
        where: { status: "PENDING", vehicleClass: rider.riderProfile?.vehicleClass, OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] },
      })
    : 0;
  const earningsResult = await db.booking.aggregate({
    where: { riderId: session.uid, status: "DELIVERED" },
    _sum: { totalFare: true },
  });

  return NextResponse.json({
    activeJobs: active,
    completedJobs: delivered,
    availableJobs: available,
    rating: rider?.riderProfile?.rating ?? 5.0,
    totalDeliveries: rider?.riderProfile?.totalDeliveries ?? 0,
    isOnline: rider?.riderPresence?.isOnline ?? false,
    earnings: Number(earningsResult._sum.totalFare ?? 0),
    vehicleClass: rider?.riderProfile?.vehicleClass,
    vehiclePlate: rider?.riderProfile?.vehiclePlate,
  });
}
