-- Additive; existing applications remain real applications.
ALTER TABLE "RiderApplication" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
-- Recognize only the explicitly seeded synthetic applications, never infer from a person's name.
UPDATE "RiderApplication" SET "isDemo" = true
WHERE "id" IN (SELECT "applicationId" FROM "RiderApplicationEvent" WHERE "action" = 'DEMO_SEEDED');
