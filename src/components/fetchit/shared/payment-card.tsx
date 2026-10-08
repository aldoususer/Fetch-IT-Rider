"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PAYMENT_STATUS_LABEL, type PaymentStatus } from "@/lib/payment-policy";
type PaymentBooking = { paymentMethod: string; paymentStatus: PaymentStatus; status: string; totalFare: number; customerPaidAmount: number | null; riderReceivedAmount: number | null; customerPaidAt: string | null; riderReceivedAt: string | null; paidAt: string | null; paymentReference: string | null };
export function PaymentCard({ bookingId, role, readOnly = false }: { bookingId: string; role: "CUSTOMER" | "RIDER"; readOnly?: boolean }) {
  const [booking, setBooking] = useState<PaymentBooking | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const version = useRef(0);
  useEffect(() => {
    if (readOnly) return;
    const controller = new AbortController();
    let first = true;
    async function refresh() {
      if (document.hidden || !navigator.onLine || pending.current) return;
      const requestVersion = version.current;
      try {
        const response = await fetch(`/api/bookings/${bookingId}/payment`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Payment record unavailable.");
        if (!controller.signal.aborted && !pending.current && requestVersion === version.current) { setBooking(data.booking); setError(""); if (first) { setAmount(Number(data.booking.totalFare).toFixed(2)); first = false; } }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Payment record unavailable."); }
    }
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15000);
    window.addEventListener("online", refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("online", refresh); };
  }, [bookingId, readOnly]);
  if (readOnly) return <p className="text-xs text-muted-foreground">Reconnect to view the payment record.</p>;
  const confirmed = role === "CUSTOMER" ? booking?.customerPaidAt : booking?.riderReceivedAt;
  const canConfirm = booking && ["ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"].includes(booking.status) && !confirmed && !["PAID", "REFUNDED"].includes(booking.paymentStatus);
  const mismatch = booking && booking.customerPaidAmount !== null && booking.riderReceivedAmount !== null && (booking.customerPaidAmount !== booking.riderReceivedAmount || booking.customerPaidAmount !== booking.totalFare);
  return <section className="rounded-xl border p-4 space-y-3 text-sm" aria-label="Payment">
    <div className="flex justify-between gap-2"><strong>Cash payment</strong><span>{booking ? PAYMENT_STATUS_LABEL[booking.paymentStatus] : "Loading…"}</span></div>
    {booking && <><p>Fare: ₱{Number(booking.totalFare).toFixed(2)}</p><div className="space-y-1"><div>Customer: {booking.customerPaidAt ? `Confirmed ₱${Number(booking.customerPaidAmount).toFixed(2)}` : "Not yet confirmed"}</div><div>Rider: {booking.riderReceivedAt ? `Received ₱${Number(booking.riderReceivedAmount).toFixed(2)}` : "Not yet confirmed"}</div>{booking.paidAt && <div>Paid: {new Date(booking.paidAt).toLocaleString()}</div>}{booking.paymentReference && <div className="break-all">Reference: {booking.paymentReference}</div>}</div>{mismatch && <p className="text-amber-700">Amounts do not match the fare. Contact support for payment review.</p>}</>}
    {canConfirm && <form className="space-y-2" onSubmit={async event => {
      event.preventDefault(); if (pending.current) return;
      if (!navigator.onLine) { setError("Reconnect to confirm payment."); return; }
      pending.current = true; version.current++; setBusy(true); setError(""); setNotice("");
      try {
        const response = await fetch(`/api/bookings/${bookingId}/payment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Couldn’t confirm payment.");
        setBooking(data.booking); setNotice("Your confirmation was recorded.");
      } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t confirm payment."); }
      finally { pending.current = false; setBusy(false); }
    }}><label className="block">{role === "CUSTOMER" ? "Amount you paid (₱)" : "Cash you received (₱)"}<input required type="number" min="0.01" step="0.01" max="9999999999.99" value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} className="mt-1 w-full rounded-md border bg-background p-2" /></label><p className="text-xs text-muted-foreground">Confirm only after cash changes hands. Both confirmations must match the fare.</p><Button type="submit" size="sm" disabled={busy || !amount}>{busy ? "Confirming…" : role === "CUSTOMER" ? "I paid this amount" : "I received this amount"}</Button></form>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
  </section>;
}
