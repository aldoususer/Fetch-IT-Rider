import { staleRequestWhere } from "@/lib/job-expiry";
import { liveApprovalWhere, approvalCoversRoute } from "@/lib/rider-eligibility";
import { dispatchPaymentWhere } from "@/lib/dispatch";
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
  let available = 0;
  if (rider?.riderPresence?.isOnline && !rider.isBanned && rider.riderProfile?.vehicleClass) {
    const approvals = await db.riderServiceApproval.findMany({ where: { userId: session.uid, vehicleClass: rider.riderProfile.vehicleClass, ...liveApprovalWhere() } });
    const candidates = await db.booking.findMany({
      where: { AND: [dispatchPaymentWhere, { NOT: staleRequestWhere() }], status: "PENDING", riderId: null, NOT: { excludedRiderIds: { has: session.uid } }, vehicleClass: rider.riderProfile.vehicleClass, type: { in: [...new Set(approvals.map(a => a.service))] }, OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] },
      select: { type: true, vehicleClass: true, pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true },
    });
    available = candidates.filter(job => approvals.some(a => a.service === job.type && approvalCoversRoute(a, job))).length;
  }
  const earningsResult = await db.booking.aggregate({
    where: { riderId: session.uid, status: "DELIVERED", paymentMethod: "CASH" },
    _sum: { totalFare: true },
  });

  const [demoEarnings, demoPaidOut] = await Promise.all([
    db.booking.aggregate({ where: { riderId: session.uid, status: "DELIVERED", paymentStatus: "PAID", paymentMethod: { not: "CASH" } }, _sum: { demoRiderEarnings: true } }),
    db.booking.aggregate({ where: { riderId: session.uid, demoPayoutAt: { not: null } }, _sum: { demoRiderEarnings: true } }),
  ]);
  return NextResponse.json({
    activeJobs: active,
    completedJobs: delivered,
    availableJobs: available,
    rating: rider?.riderProfile?.rating ?? 5.0,
    totalDeliveries: rider?.riderProfile?.totalDeliveries ?? 0,
    isOnline: rider?.riderPresence?.isOnline ?? false,
    earnings: Number(earningsResult._sum.totalFare ?? 0),
    demoEarnings: Number(demoEarnings._sum.demoRiderEarnings ?? 0),
    demoPaidOut: Number(demoPaidOut._sum.demoRiderEarnings ?? 0),
    demoAwaitingPayout: Number(demoEarnings._sum.demoRiderEarnings ?? 0) - Number(demoPaidOut._sum.demoRiderEarnings ?? 0),
    vehicleClass: rider?.riderProfile?.vehicleClass,
    vehiclePlate: rider?.riderProfile?.vehiclePlate,
  });
}
