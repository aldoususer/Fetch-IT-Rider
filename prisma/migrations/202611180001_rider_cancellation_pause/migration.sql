ALTER TABLE "RiderPresence" ADD COLUMN "offerPausedUntil" TIMESTAMP(3);
CREATE INDEX "BookingEvent_actorId_createdAt_idx" ON "BookingEvent"("actorId", "createdAt");
-- Existing table-level runtime permissions already cover this nullable field.
-- No new roles or grants are required.
