# Rider mobile workspace polish

The Rider workspace now uses a bottom navigation bar on small screens, with Available, Active and History destinations. The account profile stays in the top-right menu. Booking details and the notification inbox fill the mobile viewport; desktop dialogs remain centered.

Job navigation uses the native browser History API. Device Back returns to the originating list, Forward restores details, and each tab retains its scroll position. Leaving a job with an unsaved pickup code or signature requires confirmation. Only tab and scroll preferences are stored in session storage; booking content and form values are not persisted there.

Controls use a minimum 48px touch target. Pinch zoom is enabled. Route maps start compact and can expand without leaving the booking. Cards prioritize fare and the pickup/drop-off pair, with complete addresses retained in the job screen. The notification inbox hides optional background-alert setup behind Settings. A single board notice explains connection failures instead of stacking duplicate messages.

The workspace uses a consistent white background, deep green text, pale sage selection accents and darker orange primary buttons with readable white labels. The notification inbox and job screen share this palette, including when the device uses dark mode. The PWA theme and launch background are white. Existing acceptance, pickup, payment, expiry and notification rules are unchanged. Customer proof photos remain deferred.

## Verification (2026-10-31)

- Production webpack build, TypeScript and scoped ESLint passed.
- 41 navigation, reliability, notification and workspace tests passed, including six new History API tests.
- Browser checks at 320px and 390px: dialog position, fixed navigation, 48px header controls, map expansion and notification settings.
- A synthetic ride in an isolated database schema was accepted once through the UI. Browser Back prompted about an unsaved pickup code; cancelling preserved the code and mounted form. Back and Forward restored the correct view.
- No live customer booking was accepted or changed, and no real email was sent during these checks.

Browser viewport checks do not replace testing an installed PWA on physical Android/iOS devices. OS background push delivery and the virtual keyboard still need physical-device verification.
