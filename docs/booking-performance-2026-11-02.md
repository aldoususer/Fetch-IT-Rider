# Rider booking response performance

Rider runs in Singapore (`sin1`), next to the existing Singapore database. Verify a new request's `X-Function-Region` and the Vercel request panel's actual execution region after deploying. The ingress region alone is not proof of the execution region.

## Preserved contracts

- Booking locks, rider reservation, live session revocation checks, OTP attempts, exact cash confirmations, proof requirements and audit/outbox writes remain in place.
- A session that has just passed a live database check can skip a duplicate check only inside the same instrumented request, using object identity in AsyncLocalStorage. Tokens and client fields cannot mark themselves verified. Non-instrumented requests retain the normal check.
- Status responses hydrate customer/rider presentation details once after commit, avoiding repeated relation reads inside the locked transaction.
- Cash confirmation returns its already-read drop-off arrival state; rides do not need an arrival-event query.
- Customer owns the shared payment and routing helpers; their copies in Admin and Superadmin are updated together. No database migration or paid service was introduced.

## Timing and safe errors

Instrumented responses include `X-Request-ID`, `X-Function-Region` and `Server-Timing`. Structured `booking.performance` events report the deployment, response-handler duration, spans and a >=5000 ms flag. Fast polling reads are sampled; mutations, errors and slow reads are always recorded.

Database spans record authorization, rate limiting, model operations, transaction acquisition/BEGIN, body, lock and commit/rollback. Acquisition includes driver/network/BEGIN work; it is not a pure pool-wait measurement. Transaction and phase spans are nested and must not be summed twice. Raw SQL, coordinates, amounts, names, documents, tokens, keys and exception messages are not logged.

Proof spans separate request body reading, image processing, optional Blob transfer, database work and cleanup. Safe Prisma/network/timeout codes survive generic UI error handling. ORS spans distinguish database reservation/cache work, provider response headers, body reading and route parsing. Existing persistent route cache, duplicate suppression, quotas and vehicle restrictions remain unchanged.

`booking.client_performance` covers acceptance (including fresh GPS acquisition), pickup progress, job status, proof submission, road directions and cash confirmation. Customer's customer-facing payment component is included. Reports contain only approved timing fields and anonymous random correlation IDs. They are authenticated, same-origin, bounded to 2 KB and rate limited. They are best effort and never delay or repeat the business operation. The two-frame measurement is a browser rendering opportunity, not a precise physical-screen-paint measurement. Background tabs may postpone it.

## Lost response and retry behavior

- After a network error, timeout, server error or malformed success, affected controls check fresh saved state. They never automatically repeat the write. Input remains available when the result cannot be verified.
- Cash confirmation remains idempotent by participant/booking/amount under the booking lock; a different amount cannot rewrite a final confirmation.
- A proof form retains a UUID submission key for its unchanged payload. Server proof IDs are bound to that key, actor, booking and payload. A replay returns committed proofs, and the check is repeated under the booking lock. Changed payloads cannot replay an earlier proof; concurrent signature submissions and lost acknowledgements cannot duplicate completion counters/events. Existing file-size, type, assignment, payment and stage checks still apply.
- File upload failures keep proof data in the form. No claim is made that an unverified write failed; the control directs the rider to check saved status.

## Navigation wording

Above the external navigation links, “Open in Google Maps” and “These links open Google Maps in a new tab.” distinguish them from Fetch-It's in-app directions. Existing pickup/drop-off destination selection is unchanged.

## Verification

- Unit/component checks cover cash walls, two-sided confirmation, duplicate action prevention, route access, safe telemetry fields, request isolation and lost-response reconciliation.
- Separate authenticated Customer/Rider sessions in an isolated test schema cover payment/completion concurrency, final confirmation guards, proof replay, one signature/completion/counter increment and Customer visibility. External email, push, ORS and Blob transfers are disabled in this fixture; actual Blob/provider performance must be assessed through live timing spans.
- Local production builds use webpack because the linked node_modules worktrees are outside Turbopack's filesystem root. Hosted builds use each deployment's normal dependency installation.

Compare cold and warm response p50/p95 after release. The earlier Washington timings are evidence of a problem, not a promise that every phone action will now finish below five seconds. Function execution can continue for background dispatch/email after the HTTP response; do not count that background duration as button response time.
