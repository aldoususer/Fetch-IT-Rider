import { approvedServices, liveApprovalWhere, approvalCoversRoute } from "@/lib/rider-eligibility";
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
  if (!rider.riderPresence?.isOnline) return NextResponse.json({ jobs: [] });

  await db.riderPresence.updateMany({ where: { userId: session.uid, isOnline: true }, data: { updatedAt: new Date() } });
  await expireRiderOffers(db);

  // PENDING jobs are open to any rider of the matching vehicle class.
  // MATCHED jobs are pre-assigned to *this* rider and waiting for acceptance.
  const services = await approvedServices(db, session.uid, rider.riderProfile.vehicleClass);
  const due = { OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] };
  const where: Prisma.BookingWhereInput = includeMatched
    ? {
        vehicleClass: rider.riderProfile?.vehicleClass,
        AND: [due, dispatchPaymentWhere],
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

  const jobs = await db.booking.findMany({
    where: { ...where, type: { in: services } },
    orderBy: { createdAt: "asc" },
    take: 50,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      rider: { select: riderSelect },
    },
  });

  const approvals = await db.riderServiceApproval.findMany({ where: { userId: session.uid, vehicleClass: rider.riderProfile.vehicleClass, ...liveApprovalWhere() } });
  const eligibleJobs = jobs.filter(job => approvals.some(a => a.service === job.type && approvalCoversRoute(a, job)));
  const withTickets = eligibleJobs.map((job) => riderJobView(bookingView(job)));

  return NextResponse.json({ jobs: withTickets }, { headers: { "Cache-Control": "private, no-store" } });
}
