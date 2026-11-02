# Require payment confirmation before completing a ride

Previously, the status endpoint enforced cash payment only for deliveries.
Passenger rides could move from In transit to Complete with payment unconfirmed.
The ride button also omitted the payment-readiness check.

The Rider endpoint now checks cash payment under the existing booking row lock:
both participants must have saved confirmations, both amounts must equal the fare,
and payment status must be Paid. Unpaid/refunded online checkout remains blocked.
No completion timestamp, event, earnings or completed-job count is written when
the check fails. Successful completion remains idempotent.

The button stays disabled until the payment card has verified the saved payment.
A failed refresh blocks completion until a successful recheck. Payment details
identify the missing participant and a nearby Review payment action opens them.
An entered delivery proof remains mounted if payment verification temporarily
fails, with submission disabled. Arrival/signature/photo requirements remain.

The payment policy is synchronized across Customer, Rider, Admin and Superadmin.
Existing completed records are retained. There is no new schema or grant change.

Validation:

- 59 Rider checks, including direct endpoint bypass attempts, one-sided/mismatched
  cash, paid/unpaid online checkout, idempotency, disabled-button behavior and
  preserving delivery proof when payment becomes unavailable.
- 42 Customer checks, including existing cash, checkout, receipt, inbox and history
  behavior; the newer Customer inbox/history commit is preserved.
- Nine real-database scenarios using independent authenticated Customer/Rider
  sessions on localhost, including a race with the final payment confirmation.
  Only synthetic fixtures in the explicit isolated schema are used and removed.
  No push subscriptions or actual email deliveries are created by these tests.
- TypeScript checks for all four apps and optimized Rider/Customer builds.
