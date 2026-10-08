"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
export function ReleaseBooking({ id, onReleased }: { id: string; onReleased: () => void }) {
  const pending = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return <><Button size="sm" variant="outline" onClick={() => setOpen(true)}>Decline / release booking</Button><Dialog open={open} onOpenChange={value => { if (!pending.current) setOpen(value); }}><DialogContent><DialogHeader><DialogTitle>Release this booking?</DialogTitle><DialogDescription>The booking will be offered to another rider. You can release it only before pickup and before payment is recorded.</DialogDescription></DialogHeader><form className="space-y-3" onSubmit={async event => {
    event.preventDefault(); if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/bookings/${id}/release`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn’t release booking.");
      setOpen(false); onReleased();
    } catch (error) { setError(error instanceof Error ? error.message : "Release unavailable."); }
    finally { pending.current = false; setBusy(false); }
  }}><label className="block text-sm">Reason<textarea className="mt-2 w-full rounded-md border bg-background p-3" required maxLength={500} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} /></label>{error && <p role="alert" className="text-destructive text-sm">{error}</p>}<div className="flex gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Keep booking</Button><Button type="submit" disabled={busy || !reason.trim()}>{busy ? "Releasing…" : "Confirm release"}</Button></div></form></DialogContent></Dialog></>;
}
