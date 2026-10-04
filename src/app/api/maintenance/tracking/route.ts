import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { cleanupTracking } from "@/lib/tracking";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Tracking cleanup is not configured." }, { status: 503 });
  const received = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await cleanupTracking());
}
