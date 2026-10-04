import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { requireRider, riderErrorResponse } from "@/lib/rider-access";
import { locationInput } from "@/lib/tracking";

export async function POST(req: NextRequest) {
  try {
    const session = await requireRider(await getSession());
    const input = locationInput(await req.json());
    const data = { lat: input.lat, lng: input.lng, locationAt: new Date() };
    await db.riderPresence.upsert({ where: { userId: session.uid }, create: { userId: session.uid, ...data }, update: data });
    return NextResponse.json({ ok: true });
  } catch (error) { return riderErrorResponse(error); }
}
