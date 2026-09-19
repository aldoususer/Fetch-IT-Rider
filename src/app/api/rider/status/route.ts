// POST /api/rider/status
// Toggles the rider's availability for matching. Body: { online: boolean }

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
      { error: "Only riders can toggle their availability." },
      { status: 403 },
    );
  }
  const { online } = (await req.json()) as { online: boolean };
  const updated = await db.user.update({
    where: { id: session.uid },
    data: { isOnline: Boolean(online) },
  });
  return NextResponse.json({ isOnline: updated.isOnline });
}
