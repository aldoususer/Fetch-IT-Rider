import { withRequestLog, RateLimitError, limitRequests } from "@/lib/request-guard";
import { NextRequest, NextResponse } from "next/server";
import { getBearerSession } from "@/lib/session";
import { requireRider, RiderError, riderErrorResponse } from "@/lib/rider-access";
import { locationInput, publishLocation } from "@/lib/tracking";

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  try {
    const session = await requireRider(getBearerSession(req));
    await limitRequests("rider:gps", session.uid, 90, 60_000);
    const { ticketId } = await params;
    const normalized = ticketId.trim().toUpperCase();
    if (!/^[RD]\d{4,}$/.test(normalized)) throw new RiderError("Invalid ticket reference.", 400);
    const update = await publishLocation(normalized, session.uid, locationInput(await req.json()));
    return NextResponse.json({ ok: true, update });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    return riderErrorResponse(error);
  }
}

export const POST = withRequestLog("rider:native/tickets/[ticketId]/location:POST", handlePOST);
