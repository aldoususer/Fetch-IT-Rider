import { staleRequestWhere } from "@/lib/job-expiry";
import { liveApprovalWhere, approvalCoversRoute } from "@/lib/rider-eligibility";
import { expireRiderOffers, dispatchPaymentWhere } from "@/lib/dispatch";
import { bookingView, riderSelect } from "@/lib/db-data";
import type { Prisma } from "@prisma/client";
// GET /api/rider/available
// Returns PENDING bookings that match the rider's vehicle class.
// Only meaningful for the RIDER role.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRiderSession } from "@/lib/rider-access";
import { riderJobView } from "@/lib/job-privacy";

export async function GET(req: NextRequest) {
  const session = await getRiderSession();
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

  const rider = await db.user.findUnique({ where: { id: session.uid }, include: { riderProfile: true, riderPresence: true } });
  if (!rider || !rider.riderProfile?.vehicleClass) {
    return NextResponse.json(
      { error: "Rider profile is incomplete (missing vehicle class)." },
      { status: 400 },
    );
  }
  if (rider.isBanned) return NextResponse.json({ error: "Account restricted." }, { status: 403 });
  if (!rider.riderPresence?.isOnline) return NextResponse.json({ jobs: [], upcomingJobs: [] }, { headers: { "Cache-Control": "private, no-store" } });

  await db.riderPresence.updateMany({ where: { userId: session.uid, isOnline: true }, data: { updatedAt: new Date() } });
  await expireRiderOffers(db);

  // PENDING jobs are open to any rider of the matching vehicle class.
  // MATCHED jobs are pre-assigned to *this* rider and waiting for acceptance.
  const now = new Date();
  const approvals = await db.riderServiceApproval.findMany({ where: { userId: session.uid, vehicleClass: rider.riderProfile.vehicleClass, ...liveApprovalWhere(now) } });
  const services = [...new Set(approvals.map(a => a.service))];
  const due = { OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] };
  const where: Prisma.BookingWhereInput = includeMatched
    ? {
        vehicleClass: rider.riderProfile?.vehicleClass,
        AND: [due, dispatchPaymentWhere, { NOT: staleRequestWhere(now) }],
        OR: [
          { status: "PENDING", riderId: null, NOT: { excludedRiderIds: { has: session.uid } } },
          { status: "MATCHED", riderId: session.uid },
        ],
      }
    : {
        vehicleClass: rider.riderProfile?.vehicleClass,
        AND: [due, dispatchPaymentWhere],
        status: "PENDING" as const, riderId: null, NOT: { excludedRiderIds: { has: session.uid } },
      };

  const include = {
      customer: { select: { id: true, name: true, phone: true } },
      rider: { select: riderSelect },
  } as const;
  // Show scheduled requests now without making them claimable before pickup.
  // Separate queries keep future bookings from displacing jobs available now.
  const [jobs, upcoming] = await Promise.all([
    db.booking.findMany({ where: { ...where, type: { in: services } }, orderBy: { createdAt: "asc" }, take: 50, include }),
    db.booking.findMany({ where: { ...where, type: { in: services }, AND: [{ scheduledAt: { gt: now } }, dispatchPaymentWhere, { NOT: staleRequestWhere(now) }] }, orderBy: { scheduledAt: "asc" }, take: 50, include }),
  ]);

  const visible = (rows: typeof jobs) => rows.filter(job => approvals.some(a => a.service === job.type && approvalCoversRoute(a, job))).map(job => riderJobView(bookingView(job)));

  return NextResponse.json({ jobs: visible(jobs), upcomingJobs: visible(upcoming), checkedAt: now.toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
}
