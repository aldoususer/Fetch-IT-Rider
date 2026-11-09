# Mobile recovery improvements

The rider app now preserves unfinished delivery proof in device IndexedDB, scoped by rider and booking. A restored signature is drawn from coordinates; stored SVG markup is never inserted into HTML. A successful upload clears the draft. Explicit discard, logout, account switch, confirmed reassignment, removed active jobs and expiry also clean it up. Pickup codes and GPS are not stored in the proof cache.

The on-screen status distinguishes preparing a photo, saving locally, uploading proof and checking an ambiguous server response. Retrying the same saved proof reuses its request key. Reconnection never submits proof automatically. The existing cash/payment checks still gate completion.

Drafts remain eligible for restoration for 24 hours from their latest save. Expired entries are removed on account initialization or access. Device storage can be cleared or evicted by the browser; failures show a warning and a save-retry action. Closing before the saved confirmation appears can lose the latest change.

Empty job screens distinguish a device without internet, an offline rider, paused matching, an active booking, and no nearby requests. Job confirmation time, notification progress, manual pickup-code recovery, accessible signature controls, and completion actions use the existing workspace design.

## Verification

- TypeScript and targeted ESLint checks.
- `node --test tests/rider-ux-regression.test.cjs tests/ride-payment-completion.test.cjs tests/rider-workspace.test.cjs tests/required-photo.test.cjs tests/rider-navigation.test.cjs tests/pickup-qr-camera.test.cjs`
- `tests/proof-drafts.browser-check.ts` exports `checkProofDraftStorage()` for a disposable localhost browser fixture. It uses actual IndexedDB and checks save/read, discard races, account separation, removal, late writes, reassignment, logout races and expiry. Do not run it in an account's normal app origin: it clears proof drafts as part of its tests.
- Ten browser storage checks passed. A real browser page reload restored signature, photo, recipient and retry key; restoration sent no proof POST. The form was inspected at phone width.

Physical-phone camera and GPS permission behavior still needs device testing. No new paid service or dependency is introduced.
