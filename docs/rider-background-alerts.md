# Rider background alerts and connection recovery

## Rider experience

Open the bell and choose **Enable background alerts**, then allow notifications in the browser. New requests require the rider's Online status, matching vehicle, approved service and supported route. Riders with another active booking do not receive new-request pushes. Assigned offers and customer cancellations use the same private inbox.

Web Push can display an alert with no Rider page open. The browser/OS controls permission and delivery; force-stopping the browser, battery restrictions or network loss can delay or suppress it. On supported iPhones/iPads, install Rider to the Home Screen and enable notifications from that installed app.

Scheduled jobs receive an initial new-request alert. Precise timed pickup reminders remain in-app reminders while Rider is open. This release does not add a paid plan or minute-based scheduler.

The worker stores only the active rider identifier. Sign-out clears that identifier, closes old alerts and revokes this installation's subscription. Push payloads omit customer addresses and phone numbers. Permission is optional; the in-app inbox remains usable.

## Delivery and deployment

Apply `202610300001_rider_push_tasks` to the shared database before deploying any of the four apps. The additive outbox is written in the booking transaction; recipient selection and provider requests run afterward through `after()`, outside the booking counter lock.

Fanout is paginated and resumable. Both tasks and notifications use leases and bounded retries. Pending work resumes on booking/support events, Rider inbox refreshes, and the existing protected daily maintenance job. A prolonged provider outage with no subsequent traffic can delay retries until maintenance. Delivery is at least once; the worker replaces the same notification tag on retry. New subscriptions do not replay older events, and availability is rechecked before provider delivery.

The existing shared VAPID identity and subscription tables are reused with strict role and ownership checks. No new provider subscription or paid queue is required. Test-only transport suppression is allowed solely in development against an explicitly named isolated lab schema.

## Connection recovery

After reconnecting, focusing or reopening an active booking, Rider reads the current server state before enabling changes. Codes, payment inputs and signatures remain mounted. Failed or ambiguous writes trigger a read; mutations are never automatically replayed. Terminal statuses cannot be overwritten by an older nonterminal refresh.

## Verification

Automated coverage includes worker execution without open pages, account isolation, sign-out, duplicate tags, inbox deduplication/read ownership, eligibility, subscription baselines, expiry, cancellation, provider retries and competing workers. The provider is captured in integration tests; automated tests do not send real push or email.

For final device acceptance, use separate Customer and Rider phones: enable Rider alerts, go Online, close Rider, create an eligible request and tap its alert. Repeat cancellation, sign-out, reconnect with a partially entered pickup code, correct/incorrect pickup codes, payment acknowledgement and completion. Verify both apps agree. Repeat on Android and an installed iOS Home Screen app where supported. This physical-device/provider test is separate from browser and isolated database verification.
