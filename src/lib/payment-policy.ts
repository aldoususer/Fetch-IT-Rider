export const PAYMENT_STATUS_LABEL = { UNPAID: "Unpaid", PENDING: "Awaiting confirmation / review", PAID: "Paid", REFUNDED: "Refunded", FAILED: "Failed" } as const;
export type PaymentStatus = keyof typeof PAYMENT_STATUS_LABEL;
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
