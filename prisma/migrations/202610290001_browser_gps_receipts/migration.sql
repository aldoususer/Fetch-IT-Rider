ALTER TYPE "TrackingSource" ADD VALUE IF NOT EXISTS 'BROWSER';
ALTER TABLE "Booking"
  ADD COLUMN "receiptEmailQueuedAt" TIMESTAMP(3),
  ADD COLUMN "receiptEmailedAt" TIMESTAMP(3),
  ADD COLUMN "receiptEmailLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "receiptEmailAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "receiptEmailNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "Booking_paymentStatus_receiptEmailedAt_receiptEmailNextAttempt_idx" ON "Booking"("paymentStatus", "receiptEmailedAt", "receiptEmailNextAttemptAt");
