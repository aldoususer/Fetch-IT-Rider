# Rider jobs and presentation personas

Available requests match the rider's vehicle, live service approvals, operating zone, exclusion list, and payment eligibility. Scheduled requests appear separately under **Upcoming** as soon as they exist. They move into **Available** when pickup is due. Times in the dashboard use Asia/Manila regardless of the device timezone.

The feed returns `jobs` for due requests and `upcomingJobs` for future requests, each bounded to 50 records. Both lists apply the same authorization and privacy projection. Upcoming cards have no enabled acceptance action; the existing booking mutation and dispatch checks continue to reject acceptance/assignment before pickup time. No booking schedule is changed by this feature.

Jobs refresh every three seconds while the board is visible and connected. Stats retain their ten-second refresh to avoid querying aggregates on every jobs poll. The last successful job check is displayed; refresh failures keep existing cards visible.

The project owner explicitly enabled Delivery and Passenger access for the two existing presentation personas `courier-2@activity.fetchit.invalid` (Tricycle) and `courier-3@activity.fetchit.invalid` (Car). Their original Delivery approvals, credentials, documents, account names, and histories were preserved. Passenger approvals use the source `OWNER_PERSONA`, with an owner-request event and admin audit; no document or government-permit verification was fabricated. Tricycle passenger matching is bounded to the presentation corridor with corners 120.18–120.40 longitude, 15.95–16.10 latitude. This is a matching boundary, not a verified real operating permit.

The two personas exist in the shared `public` database. A localhost preview must connect to that same database to see live customer requests. The earlier isolated payment lab intentionally had a separate schema and did not contain these accounts. Local and deployed applications can operate on the same live booking records; running localhost does not make those transactions disposable test data. The `.invalid` email addresses cannot receive external verification or notification emails.

Validation: `node --test tests/rider-upcoming-jobs.test.cjs`, explicit TypeScript checking, scoped ESLint, and authenticated live/local API reads for both personas. Browser verification uses the actual local dashboard, without accepting customer bookings or changing their pickup schedules.
