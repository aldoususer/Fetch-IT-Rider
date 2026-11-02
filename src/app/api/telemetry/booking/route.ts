import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { limitRequests, RateLimitError } from "@/lib/request-guard";
import { validTimingId } from "@/lib/booking-telemetry";

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== request.nextUrl.origin) || request.headers.get("sec-fetch-site") === "cross-site") return new NextResponse(null, { status: 403 });
    if (Number(request.headers.get("content-length") || 0) > 2048) return new NextResponse(null, { status: 413 });
    const session = await getSession();
    if (!session || session.role !== "RIDER") return new NextResponse(null, { status: 401 });
    const reader = request.body?.getReader();
    if (!reader) return new NextResponse(null, { status: 400 });
    const decoder = new TextDecoder();
    let text = "", bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2048) { await reader.cancel(); return new NextResponse(null, { status: 413 }); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const body = JSON.parse(text);
    const duration = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 600000;
    if (!body || !["confirm", "fare", "cash_payment", "dropoff_arrival", "job_accept", "job_status", "pickup_progress", "proof_submit", "road_route"].includes(body.action) || !["confirmed", "checkout", "fare_ready", "failed", "superseded", "recovered", "uncertain"].includes(body.outcome) ||
      !validTimingId(body.eventId) || (body.requestId !== undefined && !validTimingId(body.requestId)) || !duration(body.durationMs) ||
      !duration(body.beforePaintMs) || [body.backendMs, body.responseHeadersMs].some(value => value !== undefined && !duration(value))) return new NextResponse(null, { status: 400 });
    await limitRequests("rider:booking-telemetry", session.uid, 60, 60_000);
    // Pick fields explicitly. The client is an untrusted timing source; never
    // accept arbitrary dimensions, identity fields, messages or route payloads.
    console.info(JSON.stringify({ operation: "booking.client_performance", source: "client_reported", action: body.action,
      clientEventId: body.eventId, requestId: body.requestId, outcome: body.outcome, durationMs: Math.round(body.durationMs),
      slow: body.durationMs >= 5000, beforePaintMs: Math.round(body.beforePaintMs), responseHeadersMs: body.responseHeadersMs,
      backendMs: body.backendMs,
    }));
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return new NextResponse(null, { status: error instanceof RateLimitError ? 429 : 400 }); }
}
