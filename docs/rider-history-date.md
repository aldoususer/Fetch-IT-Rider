# Rider history by date

History → Filters → Booking date (PH time) selects one calendar day. The date refers to booking creation, matching the timestamp already displayed on history rows. Status and address/reference search continue to combine with the date. Clear filters restores all dates, all statuses and the empty search.

The Rider bookings API accepts `date=YYYY-MM-DD` only for `filter=history`. It validates actual calendar dates and applies an inclusive midnight / exclusive next-midnight range in Philippine time to `createdAt`, while retaining the signed-in rider constraint. Filtering happens before the existing 100-row limit, using the existing `(riderId, status, createdAt)` index. No schema migration is needed.

History results and errors are cached separately by selected date. Existing abort and request-generation guards reject obsolete responses; changing dates shows a loading state instead of rows from the previous day. An empty filtered day offers Clear filters rather than claiming the rider has no history.
