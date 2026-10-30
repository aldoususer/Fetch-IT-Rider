# Rider workspace redesign

The Rider workspace now prioritizes finding, reviewing and continuing jobs. The latest pickup-heading/arrival controls remain intact. Customer, Admin and Superadmin booking/payment contracts, service approvals and the database schema are unchanged.

- Availability has a distinct loading state and cannot be toggled before it is verified. Failed checks have an explicit retry. Network loss keeps existing cards visible.
- Mobile jobs appear before collapsed activity statistics. GPS is a compact, separate disclosure and still requires explicit user permission.
- Request cards label pickup and drop-off in order. A route preview comes before acceptance; future requests, offline sessions, unchecked availability and riders already occupied with another pending claim have an explained disabled acceptance action. Server eligibility remains authoritative.
- Old and overdue requests show their age. They are not silently expired or rescheduled; an operational expiry/reconfirmation policy remains a separate business decision.
- Active jobs use a full-screen mobile view with a fixed action area, stage-specific navigation and shortcuts to payment/code entry. Unsaved code/signature input has a leave confirmation. Recent pickup heading/arrival controls are preserved.
- History uses compact searchable rows and collapsed filters. Its receipt-style summary has no pickup navigation, customer calling, release or payment mutation controls. Older completed records with incomplete cash acknowledgments are explicitly explained, not rewritten.
- Cash completion still requires drop-off arrival, matching Rider/Customer confirmations and recipient signature. The payment view shows a checklist and prevents a mistyped amount before sending it. Historical payment reads do not start a repeating poll.
- Applicant requirement links carry field/document/section targets and focus the relevant control after a successful step save. Upload queues and correction-only editing remain unchanged.
- Account details are labeled accurately, pickup-code errors are local to the field, and public copy describes supported features without unsupported matching-time/rating/insurance claims.
- Signature strokes notify the parent from pointer events, avoiding a state update during another component's render. Existing photo capture/access behavior is unchanged.

Verification uses an isolated lab database and synthetic accounts, never live customer bookings. Unit/component checks cover availability, schedule/age, navigation stage, history search, read-only payments, amount validation, duplicate submissions, stale polls, pickup feedback and requirement focus targets. TypeScript, scoped ESLint, the scheduled-feed tests and mobile/desktop browser checks are required before release. Screenshots are actual rendered code.
