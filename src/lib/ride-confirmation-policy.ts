export type RideConfirmationAction = "PICKUP" | "DROPOFF";
export type RideConfirmations = {
  customerPickupConfirmedAt?: unknown;
  customerDropoffConfirmedAt?: unknown;
  riderDropoffReportedAt?: unknown;
  rideDropoffIssueReportedAt?: unknown;
};

/** Customer acknowledgements are separate from pickup-code and payment checks. */
export function rideConfirmationError(booking: RideConfirmations & { type: string }, nextStatus: string): string | null {
  if (booking.type !== "RIDE") return null;
  if (["IN_TRANSIT", "DELIVERED"].includes(nextStatus) && !booking.customerPickupConfirmedAt)
    return "Waiting for the customer to confirm they’re on board in their ride screen.";
  if (nextStatus === "DELIVERED" && !booking.customerDropoffConfirmedAt)
    return "Waiting for the customer to confirm they’ve arrived at drop-off in their ride screen.";
  return null;
}
