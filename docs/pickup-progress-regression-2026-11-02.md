# Repeated pickup cards — 2 November 2026

The accepted Rider ride rendered `PickupProgress` and `JobRouteMap` as siblings with the same booking-ID key. Live booking updates could leave orphaned pickup components in the DOM, each retaining its own polling effect. An isolated run of the previous production build reached 39 pickup cards for one booking. Customer's waiting-status and pickup-status siblings had the same key collision.

Both screens now give the widgets distinct, stable keys scoped by purpose and booking. A TypeScript JSX audit covers the application component trees and rejects this collision while allowing mutually exclusive branches and separate lists. The same audit found no collisions in Admin or Superadmin. No database, permissions, booking-state or OTP changes are involved.

Related fixes:

- Failed pickup polls now reject back to the existing polling scheduler so its backoff works; manual retries catch their own errors.
- Pickup confirmation has a bounded timeout, clears its pending lock, and requests a current-booking check when the outcome is uncertain. It never automatically resends a mutation.
- Rider handles a successful null progress result as a changed booking rather than an endless loading message.
- Compact Customer status distinguishes waiting for heading, an unavailable ETA and a changed booking after loading finishes.

Verification: 53 focused Rider tests and 28 focused Customer tests pass, including the existing OTP/payment/proof/navigation guards, pickup ownership/idempotency/reassignment rules, late-response protection, duplicate taps, timeout recovery and JSX key audit. Both apps' standalone TypeScript checks and optimized production builds pass. Customer's newer completed-proof and safety UI changes are retained and their regression tests pass.

Actual browser verification uses the existing isolated schema and synthetic accounts, with external email and push transports disabled. The fixed production build holds one pickup card and one map during polls and heading/arrival changes, retaining entered pickup-code text. No real rider booking was changed during this test.

After deployment, reload the Rider PWA (or close and reopen it) to discard any cards already orphaned by the previous JavaScript build. A deployment cannot remove nodes in an already-running old client.
