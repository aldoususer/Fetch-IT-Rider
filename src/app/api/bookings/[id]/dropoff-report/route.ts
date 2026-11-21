import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRiderSession, RiderError, riderErrorResponse } from "@/lib/rider-access";
import { limitRequests, RateLimitError, withRequestLog } from "@/lib/request-guard";
import { recordBookingEvent } from "@/lib/booking-events";
import { schedulePushDelivery } from "@/lib/push-delivery";

async function post(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== request.nextUrl.origin) || request.headers.get("sec-fetch-site") === "cross-site")
      throw new RiderError("This request is not allowed.", 403);
    const session = await getRiderSession();
    if (!session) throw new RiderError("Sign in to report drop-off.", 401);
    await limitRequests("rider:dropoff-report", session.uid, 30, 60_000);
    const { id } = await params;
    const booking = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.booking.findUnique({ where: { id } });
      if (!current || current.riderId !== session.uid || current.type !== "RIDE") throw new RiderError("Ride not found.", 404);
      if (current.riderDropoffReportedAt) return current;
      if (current.status !== "IN_TRANSIT" || !current.pickedUpAt || !current.customerPickupConfirmedAt)
        throw new RiderError("Only report drop-off after verified pickup and after the trip starts.", 409);
      if (current.customerDropoffConfirmedAt) throw new RiderError("The passenger already confirmed drop-off. Refresh the ride to complete it.", 409);

      const updated = await tx.booking.update({ where: { id }, data: { riderDropoffReportedAt: new Date() } });
      const event = await recordBookingEvent(tx, id, { ...session, role: "RIDER" }, {
        action: "STATUS_CHANGED", fromStatus: "IN_TRANSIT", toStatus: "IN_TRANSIT", riderId: session.uid,
        reason: "Rider reported drop-off. Passenger confirmation is pending.",
      });
      await tx.customerNotification.create({ data: {
        sourceId: `booking:${event.id}`, customerId: current.customerId, category: "RIDE", bookingId: id, status: "IN_TRANSIT",
        title: "Please confirm your ride drop-off",
        body: `${current.refCode} · Confirm arrival or report an issue.`,
        url: `/?booking=${encodeURIComponent(id)}&type=RIDE`,
      } });
      return updated;
    });
    schedulePushDelivery(id);
    return NextResponse.json({ booking: { id, updatedAt: booking.updatedAt, riderDropoffReportedAt: booking.riderDropoffReportedAt } });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    return riderErrorResponse(error);
  }
}

export const POST = withRequestLog("rider:dropoff-report:POST", post);
