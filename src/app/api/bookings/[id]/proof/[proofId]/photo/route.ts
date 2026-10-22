import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/request-guard";

export const runtime = "nodejs";
async function handleGET(_req: NextRequest) {
  return NextResponse.json({ error: "Saved delivery photos are available to authorized staff only." }, { status: 403 });
}
export const GET = withRequestLog("rider:epod-photo:GET", handleGET);
