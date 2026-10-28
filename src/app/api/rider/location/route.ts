import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { requireRider, RiderError, riderErrorResponse } from "@/lib/rider-access";
import { locationInput, publishLocation } from "@/lib/tracking";
import { withRequestLog, RateLimitError, limitRequests } from "@/lib/request-guard";

async function handlePOST(req: NextRequest) {
  try {
    const session = await requireRider(await getSession());
    await limitRequests("rider:presence-gps", session.uid, 90, 60_000);
    const body = await req.json();
    const input = locationInput(body);
    if (typeof body.capturedAt !== "number" || !Number.isFinite(body.capturedAt) || Date.now() - body.capturedAt > 30_000 || body.capturedAt > Date.now() + 5000)
      throw new RiderError("A fresh device location is required. Retry location sharing.", 400);
    const presence = await db.riderPresence.findUnique({ where: { userId: session.uid } });
    const active = await db.booking.findMany({ where: { riderId: session.uid, status: { in: ["ACCEPTED", "PICKED_UP", "IN_TRANSIT"] } }, select: { ticketId: true } });
    if (!presence?.isOnline && !active.length) throw new RiderError("Go online before sharing your location.", 409);
    for (const booking of active) if (booking.ticketId) await publishLocation(booking.ticketId, session.uid, input, "BROWSER");
    const data = { lat: input.lat, lng: input.lng, locationAt: new Date() };
    await db.riderPresence.upsert({ where: { userId: session.uid }, create: { userId: session.uid, ...data }, update: data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    return riderErrorResponse(error);
  }
}

export const POST = withRequestLog("rider:presence-gps", handlePOST);
