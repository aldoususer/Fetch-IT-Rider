# Rider Google map display

Google Maps JavaScript API displays Rider's map. ORS continues to supply road geometry and foreground turn instructions. No Google Routes, Places, Street View or Navigation SDK calls are added. Google and OpenStreetMap/ORS attribution remain visible.

Maps initialize only when the opened job's map approaches the viewport. The same map is reused for route, GPS, stage and size changes; these updates do not reserve another map session. Opening another job or reopening a closed job can create a new billable map. The map provides pickup/drop-off markers, a fresh shared-location marker, 48px zoom controls, expand/collapse and explicit recentering. It does not request another location permission or run a second GPS watcher.

Configure Production on Rider:

```text
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<Google browser key entered privately>
GOOGLE_MAPS_ENABLED=1
GOOGLE_MAPS_DAILY_LIMIT=100
```

The Google browser key is necessarily visible to the browser. Keep the ORS server key separate. Restrict the Google key in Google Cloud to Maps JavaScript API and the HTTPS website referrer `https://fetch-it-rider.vercel.app/*`; authorize localhost separately only for local testing. Billing must already be enabled; this change does not enable billing or purchase a subscription.

The authenticated, same-origin map-session endpoint uses the existing shared `RateLimitBucket` table. It reserves at most 100 Google-load attempts per shared 24-hour budget window across all Rider instances/users; configuration can lower that ceiling, not raise it. It counts failures conservatively. Missing key, disabled switch, quota denial, timeout and Google authentication failure use the standard OpenStreetMap fallback. ORS directions and external navigation links remain usable. Responses are private/no-store.

This is an application guard, not a Google billing cap. It does not count the Customer app or requests made outside Rider. Google Cloud quotas matching the Dynamic Maps billing unit must protect the total shared billing allowance. Budget alerts alone do not stop spending. Current global pricing gives 10,000 Dynamic Maps loads/month free, aggregated across projects on the same billing account. Review actual account usage and lower Cloud quotas before enabling if zero spending is required. If the entire billing account has no other Dynamic Maps usage, a combined project quota below 322 map loads/day leaves room within 10,000 in a 31-day month; use a further safety margin and account for all other projects.

Relevant official documentation:
- https://developers.google.com/maps/billing-and-pricing/pricing
- https://developers.google.com/maps/billing-and-pricing/manage-costs
- https://developers.google.com/maps/documentation/javascript/load-maps-js-api

Verification: `node --test tests/rider-google-map.test.cjs tests/road-route-access.test.cjs tests/rider-navigation.test.cjs tests/rider-workspace.test.cjs`. Provider mocks verify no extra constructors/permits on updates, teardown during pending loads, and fallback while retaining ORS geometry. Real Google rendering and Cloud restrictions/quotas need separate verification with the configured account.
