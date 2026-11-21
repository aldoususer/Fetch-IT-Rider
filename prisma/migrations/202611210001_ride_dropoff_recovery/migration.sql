ALTER TABLE "Booking"
  ADD COLUMN "riderDropoffReportedAt" TIMESTAMP(3),
  ADD COLUMN "rideDropoffIssueReportedAt" TIMESTAMP(3);

ALTER TABLE "BookingLocation"
  ADD COLUMN "capturedAt" TIMESTAMP(3);
