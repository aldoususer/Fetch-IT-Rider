CREATE TABLE "RoadRouteCache" ("key" TEXT NOT NULL PRIMARY KEY, "result" JSONB, "expiresAt" TIMESTAMP(3) NOT NULL, "leaseUntil" TIMESTAMP(3));
CREATE INDEX "RoadRouteCache_expiresAt_idx" ON "RoadRouteCache"("expiresAt");
CREATE TABLE "RoadRouteRequest" ("id" TEXT NOT NULL PRIMARY KEY, "account" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "RoadRouteRequest_account_createdAt_idx" ON "RoadRouteRequest"("account", "createdAt");
