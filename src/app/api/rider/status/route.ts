import { approvedServices } from "@/lib/rider-eligibility";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { requireRider, RiderError, riderErrorResponse } from "@/lib/rider-access";

export async function POST(req: NextRequest) {
  try {
    const session = await requireRider(await getSession());
    const body = await req.json();
    if (typeof body?.online !== "boolean") throw new RiderError("Choose online or offline.", 400);
    const updated = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${session.uid} FOR UPDATE`;
      if (body.online) {
        const profile = await tx.riderProfile.findUnique({ where: { userId: session.uid } });
        if (!profile || !(await approvedServices(tx, session.uid, profile.vehicleClass)).length) throw new RiderError("Complete your rider application and service approval before going online.", 403);
      }
      const data = { isOnline: body.online };
      return tx.riderPresence.upsert({ where: { userId: session.uid }, create: { userId: session.uid, ...data }, update: data });
    });
    return NextResponse.json({ isOnline: updated.isOnline });
  } catch (error) { return riderErrorResponse(error); }
}
