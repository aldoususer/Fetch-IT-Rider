ALTER TABLE "RiderPresence" ADD COLUMN "locationAccuracy" DOUBLE PRECISION, ADD COLUMN "onlineAt" TIMESTAMP(3), ADD COLUMN "lastOfferAt" TIMESTAMP(3), ADD COLUMN "onlineDeviceId" TEXT;
CREATE TABLE "AutoDispatch" (
 "bookingId" TEXT PRIMARY KEY REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "phase" TEXT NOT NULL DEFAULT 'SEARCHING', "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "workerToken" TEXT, "workerUntil" TIMESTAMP(3),
 "pickupEtaSeconds" DOUBLE PRECISION, "ranking" TEXT, "lastReason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AutoDispatch_phase_nextAt_workerUntil_idx" ON "AutoDispatch"("phase", "nextAt", "workerUntil");
