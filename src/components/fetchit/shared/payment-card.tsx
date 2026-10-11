"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PAYMENT_STATUS_LABEL, PAYMENT_METHOD_LABEL, isDemoPayment, type PaymentMethod, type PaymentStatus } from "@/lib/payment-policy";
type PaymentBooking = { paymentMethod: PaymentMethod; paymentStatus: PaymentStatus; status: string; totalFare: number; customerPaidAmount: number | null; riderReceivedAmount: number | null; customerPaidAt: string | null; riderReceivedAt: string | null; paidAt: string | null; paymentReference: string | null; demoCommissionBps: number | null; demoCommission: number | null; demoRiderEarnings: number | null; demoPayoutAt: string | null; demoPayoutReference: string | null };
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
  const demo = booking && isDemoPayment(booking.paymentMethod);
  const canCheckout = demo && role === "CUSTOMER" && ["PENDING", "MATCHED", "ACCEPTED"].includes(booking.status) && !["PAID", "REFUNDED"].includes(booking.paymentStatus);
  const canConfirm = booking && booking.paymentMethod === "CASH" && ["ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"].includes(booking.status) && !confirmed && !["PAID", "REFUNDED"].includes(booking.paymentStatus);
  const mismatch = booking && booking.customerPaidAmount !== null && booking.riderReceivedAmount !== null && (booking.customerPaidAmount !== booking.riderReceivedAmount || booking.customerPaidAmount !== booking.totalFare);
  return <section className="rounded-xl border p-4 space-y-3 text-sm" aria-label="Payment">
    <div className="flex justify-between gap-2"><strong>{booking ? PAYMENT_METHOD_LABEL[booking.paymentMethod] : "Payment"}</strong><span>{booking ? `${demo ? "Demo: " : ""}${PAYMENT_STATUS_LABEL[booking.paymentStatus]}` : "Loading…"}</span></div>
    {demo && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Demo only — no real money moves. {role === "RIDER" ? "Do not collect cash for this demo booking." : "Checkout simulates payment to Fetch-It. No wallet or bank credentials are needed."}</p>}
    {booking && <><p>{demo ? "Demo fare" : "Fare"}: ₱{Number(booking.totalFare).toFixed(2)}</p><div className="space-y-1">{!demo && <><div>Customer: {booking.customerPaidAt ? `Confirmed ₱${Number(booking.customerPaidAmount).toFixed(2)}` : "Not yet confirmed"}</div><div>Rider: {booking.riderReceivedAt ? `Received ₱${Number(booking.riderReceivedAmount).toFixed(2)}` : "Not yet confirmed"}</div></>}{booking.paidAt && <div>{demo ? "Simulated payment" : "Paid"}: {new Date(booking.paidAt).toLocaleString()}</div>}{booking.paymentReference && <div className="break-all">Reference: {booking.paymentReference}</div>}{demo && <><div>Demo commission rate: {(booking.demoCommissionBps ?? 0) / 100}%</div>{booking.demoRiderEarnings !== null ? <><div>Fetch-It demo commission: ₱{Number(booking.demoCommission).toFixed(2)}</div><div>Rider demo earnings: ₱{Number(booking.demoRiderEarnings).toFixed(2)}</div><div>Demo payout: {booking.demoPayoutAt ? `Recorded ${new Date(booking.demoPayoutAt).toLocaleString()}` : "Awaiting admin review"}</div>{booking.demoPayoutReference && <div className="break-all">Demo payout reference: {booking.demoPayoutReference}</div>}</> : <p className="text-xs text-muted-foreground">Demo earnings are recorded after a paid booking is completed.</p>}</>}</div>{!demo && mismatch && <p className="text-amber-700">Amounts do not match the fare. Contact support for payment review.</p>}</>}
    {canCheckout && <Button size="sm" disabled={busy} onClick={async () => {
      if (pending.current) return;
      pending.current = true; version.current++; setBusy(true); setError("");
      try {
        const response = await fetch(`/api/bookings/${bookingId}/demo-checkout`, { method: "POST" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Demo checkout unavailable.");
        window.location.assign(data.checkoutUrl);
      } catch (error) { setError(error instanceof Error ? error.message : "Reconnect to open demo checkout."); }
      finally { pending.current = false; setBusy(false); }
    }}>{busy ? "Opening…" : booking.paymentStatus === "PENDING" ? "Resume demo checkout" : "Open demo checkout"}</Button>}
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
