import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { applicantRequest } from "@/lib/application-applicant-api";
import { withRequestLog } from "@/lib/request-guard";
export const runtime = "nodejs";
async function handle(req: NextRequest) {
  if (req.method !== "GET" && req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "This request is not allowed." }, { status: 403 });
  const session = await getSession();
  if (!session || session.role !== "RIDER") return NextResponse.json({ error: "Sign in with a rider account." }, { status: 401 });
  return applicantRequest(req, session.uid);
}
export const GET = withRequestLog("rider:application:GET", handle);
export const POST = withRequestLog("rider:application:POST", handle);
