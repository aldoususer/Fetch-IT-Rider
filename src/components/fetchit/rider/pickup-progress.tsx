"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import type { PickupProgress as Progress } from "@/lib/pickup-progress";
export function PickupProgress({ bookingId, disabled = false, onActionFailure }: { bookingId: string; disabled?: boolean; onActionFailure?: () => void }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const version = useRef(0);
  async function refresh(signal?: AbortSignal) {
    if (pending.current) return;
    const request = ++version.current;
    try {
      const res = await fetch("/api/bookings/" + encodeURIComponent(bookingId) + "/pickup-progress", { cache: "no-store", signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Pickup progress couldn’t load.");
      if (!signal?.aborted && request === version.current && !pending.current) { setProgress(data.pickupProgress); setError(""); }
    } catch (error) { if (!signal?.aborted && request === version.current) setError(error instanceof Error ? error.message : "Pickup progress couldn’t load."); }
  }
  useVisiblePoll(bookingId + ":pickup-progress", refresh, 5000);
  async function confirm(stage: "HEADING" | "ARRIVED") {
    if (pending.current || disabled) return;
    pending.current = true; version.current++; setBusy(true); setError("");
    try {
      const res = await fetch("/api/bookings/" + encodeURIComponent(bookingId) + "/pickup-progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Pickup progress couldn’t be updated.");
      setProgress(data.pickupProgress);
    } catch (error) { setError(error instanceof Error ? error.message : "Pickup progress couldn’t be updated. Retry when connected."); onActionFailure?.(); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border p-4" aria-label="Pickup arrival">
    <h3 className="font-medium">Pickup progress</h3>
    <p role="status" className="text-sm text-muted-foreground">{progress?.stage === "ARRIVED" ? "You confirmed arrival at pickup. Meet the passenger and verify their code before boarding." : progress?.stage === "HEADING" ? "The customer knows you’re heading to pickup. Confirm arrival when you reach the meeting point." : progress ? "Let the customer know when you start heading to pickup." : "Checking pickup progress…"}</p>
    <div className="flex flex-wrap gap-2">
      {progress?.stage === "ACCEPTED" && <Button type="button" variant="outline" disabled={busy || disabled} onClick={() => void confirm("HEADING")}>I’m heading to pickup</Button>}
      {progress && progress.stage !== "ARRIVED" && <Button type="button" disabled={busy || disabled} onClick={() => void confirm("ARRIVED")}>{busy ? "Updating…" : "I’ve arrived at pickup"}</Button>}
    </div>
    {error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button type="button" variant="outline" disabled={busy || disabled} onClick={() => void refresh()}>Refresh pickup progress</Button></div>}
  </section>;
}
