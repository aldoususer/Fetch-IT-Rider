import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { requireRider, RiderError, riderErrorResponse } from "@/lib/rider-access";

export async function POST(req: NextRequest) {
  try {
    const session = await requireRider(await getSession());
    const body = await req.json();
    if (typeof body?.online !== "boolean") throw new RiderError("Choose online or offline.", 400);
    const data = { isOnline: body.online };
    const updated = await db.riderPresence.upsert({ where: { userId: session.uid }, create: { userId: session.uid, ...data }, update: data });
    return NextResponse.json({ isOnline: updated.isOnline });
  } catch (error) { return riderErrorResponse(error); }
}
