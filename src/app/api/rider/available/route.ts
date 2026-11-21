import { availableRequestWhere, claimableRequestWhere, dispatchSelect, usableMatchingLocation } from '@/lib/matching-policy';
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
import { offersPaused, pauseMessage } from '@/lib/rider-cancellation-policy';

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
  if (offersPaused(rider.riderPresence)) return NextResponse.json({ jobs: [], upcomingJobs: [], pausedUntil: rider.riderPresence!.offerPausedUntil!.toISOString(), pauseReason: pauseMessage(rider.riderPresence!.offerPausedUntil!) }, { headers: { 'Cache-Control': 'private, no-store' } });
  if (!rider.riderPresence?.isOnline) return NextResponse.json({ jobs: [], upcomingJobs: [] }, { headers: { "Cache-Control": "private, no-store" } });

  await db.riderPresence.updateMany({ where: { userId: session.uid, isOnline: true }, data: { updatedAt: new Date() } });
  await expireRiderOffers(db);

  // PENDING jobs are open to any rider of the matching vehicle class.
  // MATCHED jobs are pre-assigned to *this* rider and waiting for acceptance.
  const now = new Date();
  const approvals = await db.riderServiceApproval.findMany({ where: { userId: session.uid, vehicleClass: rider.riderProfile.vehicleClass, ...liveApprovalWhere(now) } });
  const services = [...new Set(approvals.map(a => a.service))];
  const due = { OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] };
  const where: Prisma.BookingWhereInput = {
    vehicleClass: rider.riderProfile.vehicleClass,
    AND: [due, dispatchPaymentWhere, { NOT: staleRequestWhere(now) }, includeMatched ? availableRequestWhere(session.uid, now) : { status: 'PENDING', riderId: null, NOT: { excludedRiderIds: { has: session.uid } }, AND: [claimableRequestWhere(now)] }],
  };

  const include = { dispatch: { select: dispatchSelect },
      customer: { select: { id: true, name: true, phone: true } },
      rider: { select: riderSelect },
  } as const;
  // Show scheduled requests now without making them claimable before pickup.
  // Separate queries keep future bookings from displacing jobs available now.
  async function eligibleJobs(where: Prisma.BookingWhereInput, order: "createdAt" | "scheduledAt") {
    const limit = 50;
    const eligible: ReturnType<typeof riderJobView>[] = [];
    let cursor: string | undefined;
    // The tricycle operating zone is evaluated in memory. Page past rejected
    // routes before applying the rider-facing limit.
    for (;;) {
      const page = await db.booking.findMany({
        where: { ...where, type: { in: services } },
        orderBy: [{ [order]: "asc" }, { id: "asc" }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: limit,
        include,
      });
      for (const job of page) {
        if (approvals.some(approval => approval.service === job.type && approvalCoversRoute(approval, job))) {
          eligible.push(riderJobView(bookingView(job)));
          if (eligible.length === limit) return eligible;
        }
      }
      if (page.length < limit) return eligible;
      cursor = page[page.length - 1].id;
    }
  }

  const [jobs, upcomingJobs] = await Promise.all([
    usableMatchingLocation(rider.riderPresence, now.getTime()) ? eligibleJobs(where, "createdAt") : [],
    eligibleJobs({ vehicleClass: rider.riderProfile.vehicleClass, status: "PENDING", riderId: null,
      scheduledAt: { gt: now }, NOT: { excludedRiderIds: { has: session.uid } },
      AND: [dispatchPaymentWhere, { NOT: staleRequestWhere(now) }],
    }, "scheduledAt"),
  ]);

  return NextResponse.json({ jobs, upcomingJobs, checkedAt: now.toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
}
