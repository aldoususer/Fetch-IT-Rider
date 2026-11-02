import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { NextRequest } from "next/server";

type Span = { name: string; durationMs: number };
type Timing = { active: boolean; spans: Span[]; dropped: number; verified: WeakSet<object>; action?: string; failure?: { stage: string; code: string } };
const timings = new AsyncLocalStorage<Timing>();
const round = (ms: number) => Math.round(Math.max(0, ms) * 10) / 10;
export const validTimingId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

// Object identity is valid only within this request, after a live revocation
// check. Never cache authentication across requests or trust a client marker.
export function markVerifiedSession(session: object) { timings.getStore()?.verified.add(session); }
export function isVerifiedSession(session: object) { return !!timings.getStore()?.active && !!timings.getStore()?.verified.has(session); }
export function bookingFailure(stage: string, error: unknown) {
  const context = timings.getStore();
  if (!context?.active || !/^[a-z][a-z0-9_.]{0,47}$/.test(stage)) return;
  const failure = error as { code?: unknown; name?: unknown; status?: unknown } | null;
  // Never log error messages/stacks: provider and DB errors can contain secrets.
  const code = typeof failure?.code === 'string' && /^(P\d{4}|ROUTE_[A-Z_]+|ECONNRESET|ETIMEDOUT|ECONNREFUSED)$/.test(failure.code)
    ? failure.code : typeof failure?.status === 'number' && failure.status >= 400 && failure.status < 500 ? 'BUSINESS_RULE' : failure?.name === 'TimeoutError' || failure?.name === 'AbortError' ? failure.name : 'INTERNAL';
  context.failure ??= { stage, code };
}

export function setBookingAction(action: 'dropoff_arrival') { const context = timings.getStore(); if (context?.active) context.action = action; }

// Fixed phase names only: never SQL, URLs, booking IDs, addresses or payloads.
export function recordBookingTiming(name: string, durationMs: number) {
  const context = timings.getStore();
  if (!context?.active || !/^[a-z][a-z0-9_.]{0,47}$/.test(name) || !Number.isFinite(durationMs)) return;
  if (context.spans.length >= 40) { context.dropped++; return; }
  context.spans.push({ name, durationMs: round(durationMs) });
}
export async function timeBooking<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (!timings.getStore()?.active) return work();
  const started = performance.now();
  try { return await work(); }
  catch (error) { bookingFailure(name, error); throw error; }
  finally { recordBookingTiming(name, performance.now() - started); }
}

export function withBookingTelemetry<Args extends [NextRequest, ...unknown[]]>(action: string, handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args) => {
    const started = performance.now();
    const context: Timing = { active: true, spans: [], dropped: 0, verified: new WeakSet() };
    const suppliedId = args[0].headers.get("X-Booking-Event-ID");
    let response: Response | undefined;
    return timings.run(context, async () => {
      try { response = await handler(...args); return response; }
      finally {
        // Next's after() work may inherit this context. Exclude it from both the
        // response measurement and the saved phases once the handler returns.
        context.active = false;
        try {
          const durationMs = round(performance.now() - started);
          const returnedId = response?.headers.get("X-Request-ID");
          const requestId = validTimingId(returnedId) ? returnedId : randomUUID();
          const region = /^[a-z]{3}\d$/.test(process.env.VERCEL_REGION ?? "") ? process.env.VERCEL_REGION! : "local";
          response?.headers.set("X-Request-ID", requestId);
          response?.headers.set("X-Function-Region", region);
          response?.headers.set("Server-Timing", [
            `app;dur=${durationMs}`,
            ...context.spans.map((span, index) => `phase${index};dur=${span.durationMs};desc="${span.name}"`),
          ].join(", "));
          const slow = durationMs >= 5000;
          // Capture every mutation, error and slow read; sample fast polling to
          // keep telemetry from multiplying normal polling volume.
          if (args[0].method !== "GET" || !response || response.status >= 400 || slow || parseInt(requestId.slice(0, 4), 16) % 20 === 0) {
            console.info(JSON.stringify({ operation: "booking.performance", action: context.action ?? action, phase: "response", requestId,
              ...(validTimingId(suppliedId) ? { clientEventId: suppliedId } : {}), region,
              deployment: /^[a-f0-9]{7,40}$/i.test(process.env.VERCEL_GIT_COMMIT_SHA ?? "") ? process.env.VERCEL_GIT_COMMIT_SHA!.slice(0, 12) : "local",
              method: args[0].method, status: response?.status ?? 500, durationMs, slow, spans: context.spans, droppedSpans: context.dropped,
              ...(context.failure ? { failure: context.failure } : {}),
            }));
          }
        } catch { /* A telemetry failure must never replace the booking response. */ }
      }
    });
  };
}
