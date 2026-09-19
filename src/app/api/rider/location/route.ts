// POST /api/rider/location
// Rider publishes their current location (also used to keep the matching
// engine fresh). Body: { lat, lng, speedKph?, heading? }

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "RIDER") {
    return NextResponse.json(
      { error: "Only riders can publish their location." },
      { status: 403 },
    );
  }
  const body = (await req.json()) as {
    lat: number;
    lng: number;
    speedKph?: number;
    heading?: number;
  };
  if (body.lat == null || body.lng == null) {
    return NextResponse.json(
      { error: "lat and lng are required." },
      { status: 400 },
    );
  }
  await db.user.update({
    where: { id: session.uid },
    data: {
      lat: body.lat,
      lng: body.lng,
      locationAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
