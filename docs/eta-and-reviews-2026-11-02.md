# Conservative road ETAs and viewable rider ratings

## Road travel estimates

The app previously displayed the raw ORS car-profile duration. For each route or automatic pickup offer, travel planning now uses the slower of the provider duration and distance divided by the existing vehicle planning speed, plus one minute for local stops/junctions. Defaults are motorcycle 22 km/h, tricycle 18 km/h and car 20 km/h. Customer road quotes use their configured vehicle speed; delivery quotes add their existing handling allowance exactly once. Fare components and distance calculations are unchanged.

Rider directions and pickup offers show an allowance band: round travel upwards to whole minutes, then add the greater of two minutes or 25% for the upper end. It is labelled a planning estimate without live traffic. This band is not a statistical confidence interval or a guaranteed arrival time. The first policy is deliberately conservative and needs later calibration against actual driving durations, excluding pickup waiting/handling.

For a 4.39 km route whose provider estimate is six minutes:

- Car: 15–19 minutes.
- Tricycle: 16–20 minutes.
- Motorcycle: 13–17 minutes.

A slower provider duration is never shortened. Cached ORS geometry, raw duration, instructions and quota accounting remain unchanged; the planning adjustment is applied when consuming the route. No additional routing calls or paid traffic subscription are introduced. Existing bookings retain their saved quote ETA; current Rider directions recalculate from cached route data, and new quotes/offers use the new policy. Previously issued signed quotes remain valid until their normal expiry.

## Ratings and reviews

- Rider's Customer rating card opens their profile with reviews visible. The rating summary in the profile can show/hide the list.
- Customer's rider/driver profile opens with customer reviews visible. The rating summary also toggles the list.
- Each review shows stars, optional comment, service type and date in Philippine time. A new rider has an explicit no-reviews state, not a fabricated five-star rating.
- Reviews load only while the list is open, in pages of ten. Loading, retry, stale-cursor refresh, duplicate-click prevention, and cancellation when closing/changing the profile are handled locally.
- Rider API reads only the authenticated rider's reviews. Customer API first verifies ownership of the booking and then reads its assigned rider's reviews; a rider ID supplied in the query cannot change that target.
- Response fields exclude customer names, IDs, email/phone, booking IDs and addresses. Comments are rendered as escaped text, without HTML insertion. Review creation, existing aggregates, and administrative permissions are unchanged.
- The shared schema already has reviews and a rider index, so no migration or new database grant is required.

## Verification

Targeted tests cover the reported six-minute example, all three vehicle defaults, slower providers, rounding and invalid metrics, unchanged fare components, review ownership/cursor scope, tied-timestamp pagination, rating-toggle behavior, empty/retry states, matching eligibility, road route lifecycle and signature submission regression. Separate authenticated localhost sessions verify actual stored review pages and aggregates in an isolated schema, with external mail/push disabled. Production builds are checked for all four apps because the automatic matching helper is shared.
