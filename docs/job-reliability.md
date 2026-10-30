# Job reliability

Unanswered rides expire ten minutes after creation, deliveries after thirty.
Scheduled requests use the later of creation and scheduled pickup as their start.
Reassignment does not reset that window. Accepted, picked-up and in-transit work
never expires. Recorded cash is held for staff review rather than auto-cancelled.

Expiry uses the existing CANCELLED status with an explicit “Request expired”
reason and a booking event. Simulated prepaid checkouts are cancelled/refunded
through the existing payment helper in the same transaction. Records remain in
history and staff charts. No schema migration is needed.

The jobs feed, Customer status reads, staff overview/list and protected scheduler
run bounded cleanup. Expired jobs are also excluded from eligibility queries and
acceptance/reassignment rechecks deadlines under the booking lock, so a delayed
cleanup cannot allow an expired request to be claimed. With all apps closed,
cleanup is eventual (the existing daily maintenance job), rather than a new
minute-by-minute paid scheduler. It is enforced on the next feed/status request.

Rider Notifications is a device-local inbox, scoped to the signed-in user. First
use establishes a baseline without replaying old requests or cancellations. A
separate lightweight poll monitors eligible requests and assigned-job changes on
every Rider tab. New eligible requests, customer cancellations, scheduled pickup
reminders within ten minutes and requests becoming due have stable deduplication
keys. Upcoming open requests are not reservations or guaranteed assignments.
Read state and baseline survive refresh on that device. No customer contact
details or location coordinates appear in the observation response or inbox.

Alerts poll while the app is open and visible. Reopening reconciles changes since
its saved baseline (recent assigned terminal states are retained for seven days).
Optional browser alerts use the existing service worker and require a user click
to request permission. This release does not provide closed-app server push for
riders; the UI states that limitation explicitly.

Polling now reports offline/reconnecting/connected status, including ten-second
timeouts when the browser still reports online. It retains cards and local form
state, backs off up to fifteen seconds, and retries immediately on focus/network
return. Polls never replay mutations. Status and payment actions prevent rapid
duplicate taps; repeated successful status requests are idempotent server-side.

Validation: targeted logic/UI tests, existing booking/OTP/payment tests,
TypeScript and scoped lint. The isolated integration test uses independent
Customer/Rider sessions and different signing secrets against a named lab schema,
with .invalid identities and external email disabled. It covers acceptance,
heading/arrival, pickup codes, cash gating, signature completion, cancellation,
expiry, simulated refund and scheduling. It is not a physical two-phone test.
