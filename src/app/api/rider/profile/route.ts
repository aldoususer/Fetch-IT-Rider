import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { requireRider, riderErrorResponse } from "@/lib/rider-access";
import { getRiderProfile } from "@/lib/rider-profile";

export async function GET() {
  try {
    const session = await requireRider(await getSession());
    return NextResponse.json({ profile: await getRiderProfile(db, session.uid) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return riderErrorResponse(error); }
}
