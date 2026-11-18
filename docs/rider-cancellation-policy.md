# Rider cancellation policy

New avoidable cancellations of accepted jobs are counted per rider and Philippine calendar day (Asia/Manila). Four or more counted cancellations and a cancellation rate of at least 20% trigger a 15-minute pause on new offers. One, two and three cancellations show progressively stronger reminders. The rate uses distinct accepted bookings, not duplicate events. Cancelling an overnight accepted booking includes that booking in the current day's denominator.

Warnings reset at midnight. A pause already started keeps its full end time across midnight. Another qualifying cancellation can start or extend a pause. Past cancellation records without the new classification are not retroactively counted.

Safety concerns and emergency/breakdown reports are exempt and recorded in booking activity for review. Passenger no-show is exempt only for passenger rides with recorded arrival, at least five minutes of waiting and a recent accurate location within 150 metres of pickup. A safety issue can always be reported using the safety reason. Declining or missing an unaccepted offer, customer cancellations and failed requests do not count.

Cancellation remains subject to the existing before-pickup and payment safeguards. The customer request returns to matching and excludes the departing rider. The booking lock and rider lock serialize cancellation, counting and pause creation in one transaction. Retrying a completed cancellation cannot count it again. There is no fee or automatic account suspension.

Paused riders cannot receive automatic offers, claim jobs, be assigned by staff or go online. Existing active jobs can still be completed, and going offline remains available. Pause expiry is checked against the saved timestamp; no scheduler is required. Rider statistics and the job feed expose the pause end time. Booking activity retains the classified reason for staff review.

## Release and recovery

Apply migration `202611180001_rider_cancellation_pause` before releasing the four connected applications. It adds a nullable RiderPresence timestamp and a BookingEvent lookup index; existing table permissions cover both. Deploy the shared dispatch and matching helpers in Customer, Rider, Admin and Superadmin together. An application rollback can leave this additive schema in place.

Verification covers the 4/5 and 4/40 examples, exact threshold boundaries, midnight, exemptions, no-show validation, concurrent-action locking, duplicate retries, go-online and acceptance rejection, plus the actual Rider cancellation screen on mobile. Local synthetic accounts and bookings are isolated from production bookings.
