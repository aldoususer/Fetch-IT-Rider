# Nearby offers and open requests

New Customer bookings use a hybrid matching flow. Existing bookings without an `AutoDispatch` row retain their open-list behavior; no historical requests are backfilled or replayed. Customer, Rider, Admin and Superadmin use the same additive schema and dispatch rules.

## Rider availability

Go online opens a mobile dialog with two explicit actions. First enable Web Push, including a service-worker subscription saved for the signed-in rider/device. Then enable location and obtain a fresh fix before POSTing availability. Permission refusal, unsupported push, failed subscription or unsuccessful GPS leaves the account offline. Browser/OS permissions cannot be switched on by the website. iPhone users need a Home Screen web app for push.

Server validation requires the device's subscription, an approved service and a valid location captured within 30 seconds with accuracy at most 100 m. HTTP retries cannot bypass these requirements. Location uploads retain the device capture timestamp, separately from presence/HTTP activity. Turning off push on the online device or logging out also switches its availability off. This does not cancel an active booking.

While online, browser GPS updates are published in the foreground. GPS older than two minutes is excluded from automatic offers and open-request claiming; the online intent is retained and the UI explains that new offers are paused. GPS aged one to two minutes has lower ranking priority than a fresh fix. Acceptance refreshes location again and rechecks the device subscription and availability on the server. Active bookings remain recoverable during GPS/network interruptions.

## Matching

Default controls are enabled automatic matching, a 5 km pickup search radius, 45-second offers, and three offers before releasing to the open list. Superadmin can disable matching or set a radius of 1–15 km, offers of 30–45 seconds and 1–3 offers per round. Older saved configuration receives these defaults on read. Manual dispatch keeps its existing separate offer-duration control.

Candidates must be online, unbanned, have valid vehicle/service approval, recent accurate GPS, push registration and no reserved/active booking. Tricycle passenger operating-zone checks still apply. The distance shortlist uses the customer's pickup point, never the destination. Up to three nearby candidates are checked through the existing ORS road-routing service, outside database locks. When all remaining candidates have routes, estimated road travel time ranks them. Similar ETAs favour the longest-waiting rider. If ORS is unavailable or its existing quota is exhausted, the entire comparison uses nearby distance instead; no live-traffic ETA is claimed. Inaccessible/out-of-area routes are excluded. ORS still uses the existing conservative car profile for motorcycles/tricycles.

The worker locks the booking and rider before making an exclusive MATCHED offer. It stores attempt count, deadline, worker ownership and progress in `AutoDispatch`. Decline or expiry advances to the next eligible rider, rechecking location and approval. A stale worker cannot overwrite a cancellation, acceptance or staff reassignment. Manual assignment overrides automatic matching. A rider may have only one reserved/active booking.

On exhaustion or no candidate, the request becomes OPEN and appears in eligible riders' open list. Previous automatic declines/timeouts do not prevent a later deliberate selection from that list. Payment eligibility, request expiry, pickup OTP and completion/payment safeguards remain enforced. Participant responses expose only phase, attempts and approximate pickup ETA/ranking, never worker tokens or other riders' global positions.

## Background execution and limits

Immediate bookings start bounded server-side after-work; the browser does not run the matching timer. A fenced worker owns one booking for up to four minutes and runs its offer round independently of foreground polling. All API functions permit up to 300 seconds on Vercel Fluid Compute. Push delivery uses the existing shared durable outbox; assigned-offer pushes have a TTL bounded by the remaining offer time. The service worker drops expired offers and opening a notification rechecks availability. Delivery is best-effort and does not prove a rider read the message.

This is **not an always-running scheduler**. Worker state is durable, but a function interruption resumes only when another authenticated feed/status request or the protected `/api/dispatch/expire` endpoint triggers recovery. Future scheduled pickups stay in Upcoming and become eligible at their due time through that recovery path. The existing daily Hobby cron does not provide precise minute-by-minute dispatch. Configure a regular authenticated scheduler separately before promising exact unattended scheduled matching or prompt crash recovery. No paid queue, subscription, native background GPS or new third-party service is installed by this change. Existing Vercel/database/ORS usage and limits still apply.

## Rollout and verification

1. Apply only `202611010001_automatic_matching`, which adds nullable presence fields and a new dispatch table; it does not delete or activate accounts.
2. Deploy Rider first, then Admin/Superadmin, then Customer so exclusive-offer checks are live before new automated requests are created.
3. Preserve current browser/ORS keys. New accounts and existing riders prepare notifications/location through Go online.
4. Run Rider's `tests/automatching.test.cjs` and the existing navigation, push, expiry, payment and Google map regressions. Run Customer's `tests/automatching.integration.cjs` only with an explicitly isolated localhost schema and disabled external email/push. Production records are not test fixtures.

Real-device notification arrival, battery restrictions, switching apps, GPS permission revocation and iPhone Home Screen installation need device acceptance testing; localhost transport tests do not establish those results.
