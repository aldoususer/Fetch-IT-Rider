export const PAYMENT_STATUS_LABEL = { UNPAID: "Unpaid", PENDING: "Awaiting confirmation / review", PAID: "Paid", REFUNDED: "Refunded", FAILED: "Failed" } as const;
export type PaymentStatus = keyof typeof PAYMENT_STATUS_LABEL;
export const PAYMENT_METHOD_LABEL = { CASH: "Cash", DEMO_GCASH: "GCash", DEMO_MAYA: "Maya", DEMO_BANK: "Bank account" } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHOD_LABEL;
export function isDemoPayment(method: string) { return ["DEMO_GCASH", "DEMO_MAYA", "DEMO_BANK"].includes(method); }
export function demoSplit(fare: unknown, bps: number) {
  const cents = amountInCents(fare);
  if (cents === null || !Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error("Invalid demo fare or commission.");
  const commissionCents = Number((BigInt(cents) * BigInt(bps) + BigInt(5000)) / BigInt(10000));
  return { commission: commissionCents / 100, riderEarnings: (cents - commissionCents) / 100 };
}
export function amountInCents(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value);
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
export function confirmationsMatch(customer: unknown, rider: unknown, fare: unknown) {
  const total = amountInCents(fare);
  return total !== null && amountInCents(customer) === total && amountInCents(rider) === total;
}

export function cashConfirmationAvailable(type: string, status: string, dropoffReachedAt?: unknown): boolean {
  if (type === "DELIVERY") return status === "DELIVERED" || (status === "IN_TRANSIT" && !!dropoffReachedAt);
  return ["ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"].includes(status);
}

type CompletionPayment = { type: string; paymentMethod: string; paymentStatus: string; totalFare: unknown; customerPaidAmount: unknown; riderReceivedAmount: unknown; customerPaidAt: unknown; riderReceivedAt: unknown };
export function completionPaymentError(booking: CompletionPayment): string | null {
  const service = booking.type === 'RIDE' ? 'ride' : 'delivery';
  if (booking.paymentMethod !== 'CASH') return isDemoPayment(booking.paymentMethod) && booking.paymentStatus === 'PAID' ? null : `Payment must be confirmed before completing this ${service}.`;
  if (!booking.riderReceivedAt) return booking.type === 'RIDE' ? 'Confirm that you received the cash payment before completing this ride.' : 'Confirm that you received the cash payment at drop-off before completing delivery.';
  if (!booking.customerPaidAt) return `Wait for the customer to confirm their cash payment before completing ${service}.`;
  if (booking.paymentStatus !== "PAID" || !confirmationsMatch(String(booking.customerPaidAmount), String(booking.riderReceivedAmount), String(booking.totalFare))) return `The cash confirmations must match the fare before ${service} can be completed. Contact support to correct a payment.`;
  return null;
}
export function deliveryCashCompletionError(booking: CompletionPayment): string | null {
  return booking.type === 'DELIVERY' && booking.paymentMethod === 'CASH' ? completionPaymentError(booking) : null;
}
