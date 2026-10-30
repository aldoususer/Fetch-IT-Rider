import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRiderSession, requireRider, RiderError, riderErrorResponse } from "@/lib/rider-access";
import { limitRequests, RateLimitError, withRequestLog } from "@/lib/request-guard";
import { pickupEvents, pickupProgress } from "@/lib/pickup-progress";
type Params = { params: Promise<{ id: string }> };
async function get(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireRider(await getRiderSession());
    const booking = await db.booking.findFirst({ where: { id: (await params).id, riderId: session.uid },
      select: { type: true, status: true, riderId: true, matchedAt: true, createdAt: true, events: pickupEvents } });
    if (!booking) throw new RiderError("Booking not found.", 404);
    return NextResponse.json({ pickupProgress: pickupProgress(booking) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return riderErrorResponse(error); }
}
async function post(req: NextRequest, { params }: Params) {
  try {
    const session = await requireRider(await getRiderSession());
    await limitRequests("rider:pickup-progress", session.uid, 30, 60_000);
    const body = await req.json().catch(() => null);
    if (!["HEADING", "ARRIVED"].includes(body?.stage)) throw new RiderError("Choose heading to pickup or arrived at pickup.", 400);
    const id = (await params).id;
    const progress = await db.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT "id" FROM "Booking" WHERE "id" = $1 FOR UPDATE', id);
      const booking = await tx.booking.findUnique({ where: { id }, include: { events: pickupEvents } });
      if (!booking || booking.riderId !== session.uid) throw new RiderError("You are no longer assigned to this booking.", 403);
      const current = pickupProgress(booking);
      if (!current) throw new RiderError("Pickup progress is available only for accepted rides before boarding.", 409);
      if (current.stage === body.stage) return current;
      if (current.stage === "ARRIVED") throw new RiderError("Arrival is already confirmed. Verify the passenger’s pickup code when you meet.", 409);
      const event = await tx.bookingEvent.create({ data: { bookingId: id, actorId: session.uid, actorName: session.name, actorRole: "RIDER",
        action: "STATUS_CHANGED", fromStatus: "ACCEPTED", toStatus: "ACCEPTED", riderId: session.uid, reason: "PICKUP_PROGRESS:" + body.stage } });
      await tx.booking.update({ where: { id }, data: { updatedAt: event.createdAt } });
      await tx.customerNotification.create({ data: { sourceId: "pickup:" + event.id, customerId: booking.customerId,
        category: "RIDE", bookingId: id, status: "ACCEPTED",
        title: body.stage === "ARRIVED" ? "Your driver reports arrival at pickup" : "Your driver is heading to pickup",
        body: booking.refCode, url: "/?booking=" + encodeURIComponent(id) + "&type=RIDE" } });
      return { stage: body.stage as "HEADING" | "ARRIVED", at: event.createdAt.toISOString() };
    }, { maxWait: 10000, timeout: 20000 });
    return NextResponse.json({ pickupProgress: progress });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    return riderErrorResponse(error);
  }
}
export const GET = withRequestLog("rider:pickup-progress:GET", get);
export const POST = withRequestLog("rider:pickup-progress:POST", post);
