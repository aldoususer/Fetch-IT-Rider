CREATE TABLE IF NOT EXISTS "RiderNotificationTask" (
  "id" TEXT PRIMARY KEY,
  "bookingId" TEXT NOT NULL REFERENCES "Booking"("id") ON DELETE CASCADE,
  "riderId" TEXT,
  "kind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "cursor" TEXT
);
CREATE INDEX IF NOT EXISTS "RiderNotificationTask_processedAt_nextAttemptAt_idx"
  ON "RiderNotificationTask"("processedAt", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "RiderNotificationTask_bookingId_idx" ON "RiderNotificationTask"("bookingId");
