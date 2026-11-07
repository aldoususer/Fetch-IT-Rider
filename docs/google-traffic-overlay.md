# Rider traffic overlay

The accepted/current job offers one Load route action. A successful route response draws the ORS route and automatically enables nearby Google traffic on the existing map, even if Google finishes loading after the route. Booking previews and history have no route-loading or traffic controls. Before a route loads, traffic remains off. Once loaded, Show traffic / Hide traffic allows optional visibility changes. A new booking stage resets the route and traffic until Load route is used again.

The overlay is created lazily with Google's auto-refresh enabled, reused across toggles and route/GPS/resize updates, and detached when the map closes or falls back to the standard map. Route loading and traffic toggling never reserve another map session, construct another map, request Google Routes, or change fares, matching or ORS route/ETA calculations. A route failure does not enable traffic; a traffic failure does not discard a successful ORS route.

Google traffic colours represent current traffic information where coverage exists and refresh periodically, not instantly. A colour legend appears only while enabled; the ORS route is blue in this mode to distinguish it from traffic. Lack of colour is not proof of a clear road. The API cannot confirm coverage for every local road; it provides a visual overlay rather than machine-readable congestion analytics. An unavailable overlay leaves the base map and external navigation usable.

The overlay has no separate Traffic Layer billing SKU; existing Dynamic Maps usage and configured server-side map-session limits still apply. This does not enable paid traffic-aware routing.

No historical traffic prediction feature was implemented. The earlier trip-data work was a read-only inventory audit, and is set aside in favour of this overlay. Booking History and existing tracking retention are unchanged.

References: https://developers.google.com/maps/documentation/javascript/trafficlayer and https://developers.google.com/maps/documentation/javascript/usage-and-billing
