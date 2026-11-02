"use client";
import { startBookingTiming } from "@/lib/booking-client-timing";
import { savedMutation } from "@/lib/booking-mutation-client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PAYMENT_STATUS_LABEL, PAYMENT_METHOD_LABEL, cashConfirmationAvailable, completionPaymentError, deliveryCashCompletionError, isDemoPayment, type PaymentMethod, type PaymentStatus } from "@/lib/payment-policy";
type PaymentBooking = { type: string; dropoffReachedAt: string | null; paymentMethod: PaymentMethod; paymentStatus: PaymentStatus; status: string; totalFare: number; customerPaidAmount: number | null; riderReceivedAmount: number | null; customerPaidAt: string | null; riderReceivedAt: string | null; paidAt: string | null; paymentReference: string | null; demoCommissionBps: number | null; demoCommission: number | null; demoRiderEarnings: number | null; demoPayoutAt: string | null; demoPayoutReference: string | null };
export function PaymentCard({ bookingId, role, readOnly = false, summaryOnly = false, actionsDisabled = false, onActionFailure, onPaymentReady }: { bookingId: string; role: "CUSTOMER" | "RIDER"; readOnly?: boolean; summaryOnly?: boolean; actionsDisabled?: boolean; onActionFailure?: () => void; onPaymentReady?: (ready: boolean) => void }) {
  const [booking, setBooking] = useState<PaymentBooking | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const version = useRef(0);
  useEffect(() => { onPaymentReady?.(!readOnly && !busy && !error && !!booking && !completionPaymentError(booking) && (booking.type !== "DELIVERY" || booking.paymentMethod !== "CASH" || !!booking.dropoffReachedAt)); }, [booking, readOnly, busy, error, onPaymentReady]);
  useEffect(() => {
    if (readOnly) return;
    const controller = new AbortController();
    let first = true;
    let refreshing = false;
    async function refresh() {
      if (document.hidden || !navigator.onLine || pending.current || refreshing) return;
      refreshing = true;
      const requestVersion = version.current;
      try {
        const response = await fetch(`/api/bookings/${bookingId}/payment`, { cache: "no-store", signal: controller.signal });
        const data = await response.json().catch(() => ({ error: 'Payment service is temporarily unavailable. Try again.' }));
        if (!response.ok) throw new Error(data.error || "Payment record unavailable.");
        if (!controller.signal.aborted && !pending.current && requestVersion === version.current) { setBooking(data.booking); setError(""); if (first) { setAmount(Number(data.booking.totalFare).toFixed(2)); first = false; } }
      } catch (error) { if (!controller.signal.aborted && requestVersion === version.current) setError(error instanceof Error ? error.message : "Payment record unavailable."); }
      finally { refreshing = false; }
    }
    void refresh();
    const timer = summaryOnly ? undefined : setInterval(() => { void refresh(); }, 3000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); if (timer) clearInterval(timer); window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); };
  }, [bookingId, readOnly, summaryOnly]);
  async function confirmCash(action: "cash_payment" | "dropoff_arrival") {
    if (pending.current || summaryOnly || actionsDisabled) return;
    if (!navigator.onLine) { setError("Reconnect to confirm payment."); return; }
    if (action === "cash_payment" && booking && Math.round(Number(amount) * 100) !== Math.round(booking.totalFare * 100)) { setError(`The fare is ₱${Number(booking.totalFare).toFixed(2)}. Confirm that exact amount, or contact support about a payment difference.`); return; }
    const timing = startBookingTiming(action);
    let outcome: "confirmed" | "recovered" | "failed" | "uncertain" = "uncertain";
    let uncertain = true;
    pending.current = true; version.current++; setBusy(true); setError(""); setNotice("");
    const isSaved = (state: { booking: PaymentBooking }) => !!state.booking && (action === "dropoff_arrival" ? !!state.booking.dropoffReachedAt : !!(role === "CUSTOMER" ? state.booking.customerPaidAt : state.booking.riderReceivedAt) && Math.round(Number(role === "CUSTOMER" ? state.booking.customerPaidAmount : state.booking.riderReceivedAmount) * 100) === Math.round(Number(amount) * 100));
    try {
      const response = await fetch(`/api/bookings/${bookingId}/payment`, { method: "POST", headers: { "Content-Type": "application/json", ...timing.headers }, signal: AbortSignal.timeout(15000), body: JSON.stringify(action === "dropoff_arrival" ? { action: "ARRIVED_AT_DROPOFF" } : { amount }) });
      timing.response(response);
      uncertain = response.status >= 500;
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.booking) { if (!data?.booking && response.ok) uncertain = true; throw new Error(data?.error || "Couldn’t verify the saved update."); }
      setBooking(data.booking); setNotice(action === "cash_payment" ? "Your confirmation was recorded." : "Arrival confirmed."); outcome = "confirmed";
    } catch (failure) {
      if (uncertain) {
        setNotice("Checking saved status…");
        const saved = await savedMutation<{ booking: PaymentBooking }>(`/api/bookings/${bookingId}/payment`, isSaved);
        if (saved) { setBooking(saved.booking); setNotice("Your update is saved."); outcome = "recovered"; return; }
      }
      setNotice(""); setError(uncertain ? "Couldn’t verify the update. Your entered amount is kept. Reconnect to check its status before retrying." : failure instanceof Error ? failure.message : "Couldn’t confirm payment.");
      outcome = uncertain ? "uncertain" : "failed"; onActionFailure?.();
    } finally { pending.current = false; setBusy(false); timing.finish(outcome); }
  }
  if (readOnly) return <p className="text-xs text-muted-foreground">Reconnect to view the payment record.</p>;
  const confirmed = role === "CUSTOMER" ? booking?.customerPaidAt : booking?.riderReceivedAt;
  const demo = booking && isDemoPayment(booking.paymentMethod);
  const canCheckout = !summaryOnly && demo && role === "CUSTOMER" && ["PENDING", "MATCHED", "ACCEPTED"].includes(booking.status) && !["PAID", "REFUNDED"].includes(booking.paymentStatus);
  const canConfirm = !summaryOnly && booking && booking.paymentMethod === "CASH" && cashConfirmationAvailable(booking.type, booking.status, booking.dropoffReachedAt) && !confirmed && booking.paymentStatus !== "REFUNDED";
  const deliveryCash = booking?.type === "DELIVERY" && booking.paymentMethod === "CASH";
  const canArrive = !summaryOnly && role === "RIDER" && deliveryCash && booking.status === "IN_TRANSIT" && !booking.dropoffReachedAt;
  const mismatch = booking && booking.customerPaidAmount !== null && booking.riderReceivedAmount !== null && (booking.customerPaidAmount !== booking.riderReceivedAmount || booking.customerPaidAmount !== booking.totalFare);
  return <section className="rounded-xl border p-4 space-y-3 text-sm" aria-label="Payment">
    <div className="flex justify-between gap-2"><strong>{booking ? PAYMENT_METHOD_LABEL[booking.paymentMethod] : "Payment"}</strong><span>{booking ? PAYMENT_STATUS_LABEL[booking.paymentStatus] : "Loading…"}</span></div>
    {summaryOnly && booking?.status === 'DELIVERED' && booking.paymentMethod === 'CASH' && (booking.paymentStatus !== 'PAID' || !booking.customerPaidAt || !booking.riderReceivedAt) && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><strong>{booking.type === 'RIDE' ? 'Ride completed' : 'Delivery completed'} · Payment confirmation incomplete</strong><p className="mt-1">This is the saved payment record, not a new request to collect cash. Contact support if it needs correction.</p></div>}
    {!summaryOnly && booking?.type === 'RIDE' && booking.paymentMethod === 'CASH' && booking.status === 'IN_TRANSIT' && <p role="status" className="rounded-lg bg-muted/40 p-3">{!booking.riderReceivedAt ? role === 'RIDER' ? 'Confirm cash received after collecting the fare.' : 'Waiting for the rider to confirm cash received.' : !booking.customerPaidAt ? role === 'CUSTOMER' ? 'Confirm cash paid after handing the fare to the rider.' : 'Your cash confirmation is saved. Waiting for the customer to confirm payment.' : completionPaymentError(booking) ?? 'Cash payment confirmed by both sides. This ride can now be completed.'}</p>}
    {demo && <p className="text-xs text-muted-foreground">Test payment — no money charged. {role === "RIDER" ? "Online payment: do not collect cash." : ""}</p>}
    {deliveryCash && !["IN_TRANSIT", "DELIVERED", "CANCELLED"].includes(booking.status) && <p className="text-xs text-muted-foreground">Cash is collected at drop-off. Confirmation will appear after arrival.</p>}
    {!summaryOnly && deliveryCash && booking.status === "IN_TRANSIT" && <><p role="status" className="rounded-lg bg-muted/40 p-3">{!booking.dropoffReachedAt ? "At the destination, confirm arrival to open cash payment." : booking.riderReceivedAt && !booking.customerPaidAt ? "Your cash confirmation is saved. Waiting for the customer to confirm payment." : deliveryCashCompletionError(booking) ?? "Cash payment confirmed by both sides. Collect the recipient signature and drop-off photo to complete delivery."}</p><ol className="rd-payment-progress" aria-label="Cash delivery checklist">{[['Arrived at drop-off', !!booking.dropoffReachedAt], ['Cash received by you', !!booking.riderReceivedAt], ['Customer confirmed payment', !!booking.customerPaidAt]].map(([label, done], index)=><li key={String(label)} className={done?'is-done':''}><span aria-hidden="true">{done?'✓':index+1}</span><span>{String(label)}<span className="sr-only">{done?' complete':' pending'}</span></span></li>)}</ol></>}
    {canArrive && <Button type="button" size="sm" disabled={busy || actionsDisabled} onClick={() => void confirmCash("dropoff_arrival")}>{busy ? "Confirming arrival…" : "I’m at drop-off"}</Button>}
    {booking && <><p>Fare: ₱{Number(booking.totalFare).toFixed(2)}</p><div className="space-y-1">{!demo && <><div>Customer: {booking.customerPaidAt ? `Confirmed ₱${Number(booking.customerPaidAmount).toFixed(2)}` : "Not yet confirmed"}</div><div>Rider: {booking.riderReceivedAt ? `Received ₱${Number(booking.riderReceivedAmount).toFixed(2)}` : "Not yet confirmed"}</div></>}{booking.paidAt && <div>Paid: {new Date(booking.paidAt).toLocaleString()}</div>}{booking.paymentReference && <div className="break-all">Reference: {booking.paymentReference}</div>}{demo && <><div>Commission rate: {(booking.demoCommissionBps ?? 0) / 100}%</div>{booking.demoRiderEarnings !== null ? <><div>Fetch-It commission: ₱{Number(booking.demoCommission).toFixed(2)}</div><div>Rider earnings: ₱{Number(booking.demoRiderEarnings).toFixed(2)}</div><div>Payout: {booking.demoPayoutAt ? `Recorded ${new Date(booking.demoPayoutAt).toLocaleString()}` : "Awaiting admin review"}</div>{booking.demoPayoutReference && <div className="break-all">Payout reference: {booking.demoPayoutReference}</div>}</> : <p className="text-xs text-muted-foreground">Rider earnings are recorded after completion.</p>}</>}</div>{!demo && mismatch && <p className="text-amber-700">Amounts do not match the fare. Contact support for payment review.</p>}</>}
    {canCheckout && <Button size="sm" disabled={busy || actionsDisabled} onClick={async () => {
      if (pending.current || summaryOnly || actionsDisabled) return;
      pending.current = true; version.current++; setBusy(true); setError("");
      try {
        const response = await fetch(`/api/bookings/${bookingId}/demo-checkout`, { method: "POST" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Checkout unavailable.");
        window.location.assign(data.checkoutUrl);
      } catch (error) { setError(error instanceof Error ? error.message : "Reconnect to open checkout."); }
      finally { pending.current = false; setBusy(false); }
    }}>{busy ? "Opening…" : booking.paymentStatus === "PENDING" ? "Resume payment" : "Continue to payment"}</Button>}
    {canConfirm && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void confirmCash("cash_payment"); }}><label className="block">{role === "CUSTOMER" ? "Amount you paid (₱)" : "Cash you received (₱)"}<input required type="number" min="0.01" step="0.01" max="9999999999.99" value={amount} disabled={busy || actionsDisabled} onChange={event => setAmount(event.target.value)} className="mt-1 w-full rounded-md border bg-background p-2" /></label><p className="text-xs text-muted-foreground">Confirm only after cash changes hands. Both confirmations must match the fare.</p><Button type="submit" size="sm" disabled={busy || actionsDisabled || !amount}>{busy ? "Confirming…" : role === "CUSTOMER" ? "Confirm cash paid" : "Confirm cash received"}</Button></form>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
  </section>;
}
