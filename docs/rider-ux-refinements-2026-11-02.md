# Rider UX refinements — 2 November 2026

## Changes

- Availability distinguishes ready, paused, offered and active work. Paused setup resumes notifications/GPS preparation and its Go offline action saves the server state. Unknown or failed responses are not presented as success.
- History hides location setup without unmounting the location publisher. Paused empty feeds explain the reason rather than claiming no work exists.
- Unaccepted offers have a single-tap decline. Accept/decline share a pending lock. The release endpoint checks ownership, expiry and MATCHED status under the booking lock when offerOnly is true, preventing a stale decline from releasing an accepted job. Accepted-job release retains its reason dialog and existing safeguards.
- Delivery proof shows signature/photo readiness, local image preparation, selected filename, saving feedback and recoverable errors. Failed submissions retain the mounted draft. Photo removal and signature clearing have 48px targets. The job body scrolls while its header/actions remain fixed, including during input focus.
- Public and payment copy now describes the existing signature-and-photo requirement. Approval, OTP, payment and proof requirements remain enforced.
- The backward-compatible dispatch helper is synchronized across Customer, Rider, Admin and Superadmin. No migration or new permissions are needed.

## Verification

- 51 focused Rider tests pass: matching preparation, expiry, notifications, navigation, payment, pickup feedback, required photo and six new UX/race/retry regression tests.
- 10 focused Customer booking/payment checks pass; four additional payment-policy checks pass.
- TypeScript checks pass for all four release worktrees. Rider's optimized production build passes; its build config skips type validation, so TypeScript was run separately.
- Actual browser checks used the existing isolated test schema with email/push transports disabled. Checked desktop, 390×844 and 320×640 layouts; permission setup, paused feed, uncluttered History, proof filename/removal, checklist and focus scrolling. At 390px the job header remained at y=0, its outer scroll offset was zero and its action footer ended at y=844 after focusing the recipient field.
- The test photo was an existing local logo asset. No proof was submitted to production and no live booking or rider permission was changed.

## Remaining device validation

Real Android/iPhone camera permissions, keyboard resizing, background push delivery and GPS suspension still require device testing. Browser emulation does not establish those results. Precise unattended scheduled dispatch still needs the separately discussed scheduler.
