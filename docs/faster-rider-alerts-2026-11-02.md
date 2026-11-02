# Faster rider booking alerts

Recent production metadata showed roughly 15 seconds from booking creation to
offer creation, followed by roughly 18 seconds to completion of the notification
delivery job. This is server timing, not a measurement of the phone displaying
the notification.

Changes shared by Customer, Rider, Admin and Superadmin:

- Give matching's optional road-ETA lookups a shared three-second deadline,
  including route reservation and provider time. Use the existing comparable
  distance ranking on provider timeout. Normal map directions keep their normal
  timeout, conservative vehicle options, cache and quota protections. Database
  cleanup/transaction settlement can extend the measured total beyond the ETA
  deadline. No extra paid API is introduced.
- Retrieve rider eligibility in filtered relation queries and batch the inbox
  insert, avoiding repeated per-recipient database reads. Recheck booking state,
  assignment, expiry, location, service approval and operating zone before push.
- Drain a new offer's booking specifically instead of first processing unrelated
  notification work. Keep global recovery for older pending tasks.
- Drain existing notifications concurrently with long-running offer workers,
  so unrelated alerts do not wait for the worker's offer lifetime.
- Log push-service acceptance with queue/provider durations and opaque booking
  ID; no endpoint, credentials, recipient email or customer address is logged.

Validation: 74 Rider checks, 40 Customer checks, standalone TypeScript checks in
all four apps and the optimized Rider build. Isolated real-database tests use
recorded push transport, never actual device notifications. Open-request delivery
fell from 40 queries/about 2.3 seconds to 22 queries/about 1.1 seconds in that lab;
exclusive-offer delivery also used fewer queries. See the integration result
artifact for the final run. The integration removes its synthetic fixtures.

No schema, grants, credentials or hosting plan changes. Phone/network/background
delivery time is not guaranteed. This change does not add a regular scheduler.
