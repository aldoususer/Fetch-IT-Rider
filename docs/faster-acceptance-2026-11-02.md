# Combined GPS and booking acceptance

Accept reuses an accurate device fix no more than 15 seconds old. Fixes live only in page memory, are scoped to the rider account, and are cleared when the location watcher stops or reports an error. Revoked location permission prevents reuse; browsers without a supported Permissions API still go through the browser's location permission check. Going online continues to request a new fix.

The client sends one booking PATCH with the fix instead of uploading location and then sending acceptance. The button distinguishes checking location from accepting. A network timeout reports an uncertain result and instructs the rider to check Active; it never automatically resends a mutation or reports success before the server confirms it.

Inside the booking transaction, the server retains the booking and rider locks, validates location freshness and accuracy again, and conditionally updates an online rider's presence. A newer location is never overwritten and an offline rider is never switched online. Device-specific notifications, current account state, vehicle/service approval, dispatch availability, request expiry and conflicting active work remain checked. Failed acceptance rolls back its submitted GPS. The dispatch and subscription checks each run once. Older clients can still accept using fresh GPS previously saved through the existing endpoint.

The optional shared dispatch input is synchronized across all four apps; automatic matching and staff assignment retain their existing path. No migration, additional permissions, routing provider or environment variable is required. Current-job reconnection checks remain in place.

Verification includes client cache/permission tests, a one-PATCH test, timeout/no-retry behavior and reservation guards. Local production-build integration verifies an offline rider is rejected, GPS/acceptance commit together, Customer sees acceptance, retries produce one event, failed acceptance rolls GPS back, invalid fixes are rejected and concurrent riders produce exactly one winner. External email and push transport are disabled in the isolated schema.

The controlled HTTP-only comparison excluded device GPS and was approximately 1.6 seconds for both paths. It is not a phone-latency claim: the main improvement is removing an avoidable GPS acquisition and network request when an accurate recent fix exists. Slow GPS acquisition remains possible when a new fix is genuinely needed.

Run focused tests from Rider:

    node --test tests/rider-acceptance.test.cjs

Run integration only with the explicitly isolated schema and localhost apps:

    node tests/rider-acceptance.integration.cjs path/to/isolated-env.json
