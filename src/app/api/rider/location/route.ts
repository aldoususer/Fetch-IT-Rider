import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { requireRider, riderErrorResponse } from "@/lib/rider-access";
import { locationInput } from "@/lib/tracking";
import { withRequestLog, RateLimitError, limitRequests } from "@/lib/request-guard";

async function handlePOST(req: NextRequest) {
  try {
    const session = await requireRider(await getSession());
    await limitRequests("rider:presence-gps", session.uid, 90, 60_000);
    const input = locationInput(await req.json());
    const data = { lat: input.lat, lng: input.lng, locationAt: new Date() };
    await db.riderPresence.upsert({ where: { userId: session.uid }, create: { userId: session.uid, ...data }, update: data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    return riderErrorResponse(error);
  }
}

export const POST = withRequestLog("rider:presence-gps", handlePOST);
