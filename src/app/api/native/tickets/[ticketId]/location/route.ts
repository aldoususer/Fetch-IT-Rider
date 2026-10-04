import { NextRequest, NextResponse } from "next/server";
import { getBearerSession } from "@/lib/session";
import { requireRider, RiderError, riderErrorResponse } from "@/lib/rider-access";
import { locationInput, publishLocation } from "@/lib/tracking";

export async function POST(req: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  try {
    const session = await requireRider(getBearerSession(req));
    const { ticketId } = await params;
    const normalized = ticketId.trim().toUpperCase();
    if (!/^[RD]\d{4,}$/.test(normalized)) throw new RiderError("Invalid ticket reference.", 400);
    const update = await publishLocation(normalized, session.uid, locationInput(await req.json()));
    return NextResponse.json({ ok: true, update });
  } catch (error) { return riderErrorResponse(error); }
}
