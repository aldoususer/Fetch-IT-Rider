# Rider traffic overlay

The Rider job map offers Show traffic / Hide traffic while Google Maps is active. The overlay is created lazily on first use with Google's auto-refresh enabled, reused across toggles and route/GPS/resize updates, and detached when the map closes or falls back to the standard map. The toggle never reserves another map session, constructs another map, requests Google Routes, or changes fares, matching or ORS route/ETA calculations.

Google traffic colours represent current traffic information where coverage exists and refresh periodically, not instantly. A colour legend appears only while enabled; the ORS route is blue in this mode to distinguish it from traffic. Lack of colour is not proof of a clear road. The API cannot confirm coverage for every local road; it provides a visual overlay rather than machine-readable congestion analytics. An unavailable overlay leaves the base map and external navigation usable.

The overlay has no separate Traffic Layer billing SKU; existing Dynamic Maps usage and configured server-side map-session limits still apply. This does not enable paid traffic-aware routing.

No historical traffic prediction feature was implemented. The earlier trip-data work was a read-only inventory audit, and is set aside in favour of this overlay. Booking History and existing tracking retention are unchanged.

References: https://developers.google.com/maps/documentation/javascript/trafficlayer and https://developers.google.com/maps/documentation/javascript/usage-and-billing
