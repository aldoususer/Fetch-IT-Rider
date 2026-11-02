"use client";

export function startBookingTiming(action: "confirm" | "fare" | "cash_payment" | "dropoff_arrival" | "job_accept" | "job_status" | "pickup_progress" | "proof_submit" | "road_route") {
  const started = performance.now(), eventId = crypto.randomUUID();
  let requestId: string | undefined, backendMs: number | undefined, responseHeadersMs: number | undefined;
  let finished = false;
  return {
    headers: { "X-Booking-Event-ID": eventId },
    response(response: Response) {
      responseHeadersMs = performance.now() - started;
      const id = response.headers.get("X-Request-ID");
      if (id && /^[a-f0-9-]{36}$/i.test(id)) requestId = id;
      const duration = /(?:^|,\s*)app;dur=([\d.]+)/.exec(response.headers.get("Server-Timing") ?? "");
      if (duration) backendMs = Number(duration[1]);
    },
    finish(outcome: "confirmed" | "checkout" | "fare_ready" | "failed" | "superseded" | "recovered" | "uncertain") {
      if (finished) return;
      finished = true;
      const beforePaintMs = performance.now() - started;
      const report = () => {
        const payload = { action, eventId, requestId, outcome, backendMs, responseHeadersMs,
          beforePaintMs, durationMs: performance.now() - started };
        // Best-effort same-origin telemetry never delays a booking or retries it.
        void fetch("/api/telemetry/booking", { method: "POST", credentials: "same-origin", keepalive: true,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => {});
      };
      if (typeof requestAnimationFrame === "function" && outcome !== "checkout" && outcome !== "superseded") {
        requestAnimationFrame(() => requestAnimationFrame(report));
      } else report();
    },
  };
}
