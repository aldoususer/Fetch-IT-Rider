-- Optional snapshot: historical bookings retain their original fares.
ALTER TABLE "Booking" ADD COLUMN "fareBreakdown" JSONB;

-- Update only delivery pricing, preserving service availability and dispatch settings.
UPDATE "PlatformConfig"
SET "settings" = jsonb_set("settings", '{fares}', COALESCE("settings"->'fares', '{}'::jsonb) ||
'{"MOTORCYCLE":{"baseFare":50,"minimumFare":50,"includedKm":2,"perKm":10,"longHaulPerKm":10,"freeWeightKg":5,"perKgOverFree":0},"TRICYCLE":{"baseFare":70,"minimumFare":70,"includedKm":2,"perKm":15,"longHaulPerKm":15,"freeWeightKg":10,"perKgOverFree":0},"SEDAN":{"baseFare":100,"minimumFare":100,"includedKm":2,"perKm":20,"longHaulPerKm":20,"freeWeightKg":20,"perKgOverFree":0}}'::jsonb),
"version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'platform';
