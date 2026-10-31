# Openrouteservice integration

## Scope

Customer quotes use ORS road distance and duration when enabled. The resulting fare is signed and bound to the customer, coordinates, vehicle, service, weight/passengers and pickup schedule for ten minutes. Booking confirmation verifies this snapshot without another provider request. Existing bookings retain their recorded fare and ETA. Refreshed quote tokens do not create a second logical booking after a lost response.

Customer route maps request ORS through the server instead of calling Google Routes. Existing Google map tiles/address search are independent services; this integration does not replace their billing or configuration.

Riders load road directions on demand. Before acceptance the route covers pickup to drop-off. After acceptance, a fresh shared rider location is required and the destination is pickup; after pickup it becomes drop-off. The map renders road geometry, and foreground guidance advances using the existing location-sharing stream. Two distinct off-route fixes can trigger rerouting, with a 90-second minimum between automatic requests. Poor or stale GPS does not advance guidance. Arrival guidance never changes booking/payment/proof state.

This release does not add multi-stop batching, traffic-aware ETA, voice navigation, automatic matching, or background GPS. ORS uses `driving-car`; Motorcycle/Tricycle avoid highways, tollways and ferries, but this is not a motorcycle-specific routing profile. Tricycle passenger routes are checked against the approved operating-zone polygon, including route vertices. Local road access still needs field verification.

## Free-plan configuration

Use a free HeiGIT Standard key. Set these **server-only** variables on Customer and Rider with the same shared database:

```
OPENROUTESERVICE_API_KEY=<enter privately in server settings>
OPENROUTESERVICE_ENABLED=1
OPENROUTESERVICE_DAILY_LIMIT=1800
OPENROUTESERVICE_MINUTE_LIMIT=30
```

Do not prefix the key with `NEXT_PUBLIC_`, commit it, or place it in a URL. Admin/Superadmin do not need the key. Confirm the account's actual quota before enabling, and use a dedicated key for Fetch-It: requests made outside this system cannot be counted by its local guard.

Apply `202610310001_road_routing` once to the shared database before enabling routing. The additive schema is checked in to all four apps. No existing booking columns or records are changed.

`RoadRouteRequest` enforces rolling 24-hour/minute budgets under a PostgreSQL advisory lock per key hash, shared across instances and both apps. Limits cannot exceed 1800/30 even if environment values are larger. Failed provider attempts consume budget. A 20-second route lease suppresses simultaneous identical calls; failures cool down for one minute. Valid routes are reused for 24 hours. Expired cache/budget rows are pruned in bounded batches. Route caches contain coordinates and instructions, never names, emails, credentials or user IDs.

Provider, quota and timeout failures return explicit errors; they do not silently invent a road route or change the fare. When routing is disabled or the key is absent, Customer retains its existing clearly labelled distance estimate and Rider hides the new directions control. Existing external navigation links remain available.

ORS attribution links are shown with route maps/instructions. OpenStreetMap attribution remains on the Rider map. Relevant official documentation:

- https://giscience.github.io/openrouteservice/frequently-asked-questions
- https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/

## Verification

- `node --test tests/road-routing.test.cjs tests/road-route.test.cjs tests/booking-confirm.test.mjs`
- `tests/road-routing.integration.cjs` requires explicit isolated test configuration and localhost servers using a **local fixture provider**. It refuses production schema names and real-email actors. Fixture routes are not real provider results.
- Real ORS account/key connectivity and physical-road checks must be verified separately before declaring live directions operational.
