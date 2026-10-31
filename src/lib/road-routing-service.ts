import { createHash, randomUUID } from 'node:crypto';
import { db } from './db';
import { bookingServiceAreaError } from './service-area';
import { parseRoadRoute, routeOptions, RoutingError, type RoadRoute, type RoutePoint } from './road-routing';

export const routingEnabled = () => !!process.env.OPENROUTESERVICE_API_KEY?.trim() && process.env.OPENROUTESERVICE_ENABLED !== '0';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const bounded = (value: string | undefined, fallback: number, ceiling: number) => Math.min(ceiling, Math.max(1, Number.isInteger(Number(value)) ? Number(value) : fallback));
export async function roadRoute(start: RoutePoint, finish: RoutePoint, vehicle: string): Promise<RoadRoute> {
  if (!routingEnabled()) throw new RoutingError('ROUTE_NOT_CONFIGURED', 'Road directions are not enabled yet. Use the navigation link.');
  const coverage = bookingServiceAreaError(start, finish);
  if (coverage) throw new RoutingError('SERVICE_UNAVAILABLE', coverage, 422);
  const options = routeOptions(vehicle), apiKey = process.env.OPENROUTESERVICE_API_KEY!.trim(), account = sha(apiKey);
  const key = sha(JSON.stringify([account, 'driving-car-v1', options, start.lat, start.lng, finish.lat, finish.lng]));
  type Cached = { result: RoadRoute | null; expiresAt: Date; leaseUntil: Date | null };
  const reservation = await db.$transaction(async tx => {
    // Global per-key lock coordinates every deployment sharing this database.
    // It protects rolling quotas and suppresses duplicate route requests.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ors:${account}`}, 0))::text`;
    const now = new Date();
    const rows = await tx.$queryRaw<Cached[]>`SELECT "result", "expiresAt", "leaseUntil" FROM "RoadRouteCache" WHERE "key" = ${key}`;
    const cached = rows[0];
    if (cached?.result && cached.expiresAt > now) return { cached: cached.result };
    if (cached?.leaseUntil && cached.leaseUntil > now) throw new RoutingError('ROUTE_BUSY', 'Directions are being prepared. Please retry shortly.');
    if (cached && !cached.result && cached.expiresAt > now) throw new RoutingError('ROUTE_COOLDOWN', 'Routing is temporarily unavailable. Please try again shortly.');
    const usage = await tx.$queryRaw<{ minute: number; day: number }[]>`SELECT
      COUNT(*) FILTER (WHERE "createdAt" > CURRENT_TIMESTAMP - INTERVAL '60 seconds')::integer AS "minute",
      COUNT(*)::integer AS "day" FROM "RoadRouteRequest" WHERE "account" = ${account} AND "createdAt" > CURRENT_TIMESTAMP - INTERVAL '24 hours'`;
    if (usage[0].minute >= bounded(process.env.OPENROUTESERVICE_MINUTE_LIMIT, 30, 30) || usage[0].day >= bounded(process.env.OPENROUTESERVICE_DAILY_LIMIT, 1800, 1800))
      throw new RoutingError('ROUTE_QUOTA', 'Routing is temporarily unavailable because the free request limit was reached. Try again later.', 429);
    await tx.$executeRaw`INSERT INTO "RoadRouteRequest" ("id", "account", "createdAt") VALUES (${randomUUID()}, ${account}, CURRENT_TIMESTAMP)`;
    await tx.$executeRaw`INSERT INTO "RoadRouteCache" ("key", "result", "expiresAt", "leaseUntil") VALUES (${key}, NULL, ${now}, ${new Date(now.getTime() + 20000)})
      ON CONFLICT ("key") DO UPDATE SET "result" = NULL, "expiresAt" = EXCLUDED."expiresAt", "leaseUntil" = EXCLUDED."leaseUntil"`;
    await tx.$executeRaw`DELETE FROM "RoadRouteRequest" WHERE "id" IN (SELECT "id" FROM "RoadRouteRequest" WHERE "createdAt" < CURRENT_TIMESTAMP - INTERVAL '25 hours' LIMIT 100)`;
    await tx.$executeRaw`DELETE FROM "RoadRouteCache" WHERE "key" IN (SELECT "key" FROM "RoadRouteCache" WHERE "expiresAt" < CURRENT_TIMESTAMP - INTERVAL '1 day' AND ("leaseUntil" IS NULL OR "leaseUntil" < CURRENT_TIMESTAMP) LIMIT 25)`;
    return { cached: null };
  }, { maxWait: 5000, timeout: 10000 });
  if (reservation.cached) return reservation.cached;
  try {
    // Fixed provider URL, no client-supplied URL and no credentials in logs/URLs.
    const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { Authorization: apiKey, 'Content-Type': 'application/json', Accept: 'application/geo+json' },
      body: JSON.stringify({ coordinates: [[start.lng, start.lat], [finish.lng, finish.lat]], radiuses: [150, 150], instructions: true, language: 'en', units: 'm', options }),
    });
    if (!response.ok) throw new RoutingError(response.status === 429 || response.status === 403 ? 'ROUTE_PROVIDER_LIMIT' : 'ROUTE_PROVIDER', response.status === 404 ? 'No accessible road route was found for these locations.' : 'Road directions are temporarily unavailable. Please retry later.', response.status === 404 ? 422 : 503);
    const route = parseRoadRoute(await response.json(), start, finish);
    await db.$executeRaw`UPDATE "RoadRouteCache" SET "result" = ${JSON.stringify(route)}::jsonb, "expiresAt" = ${new Date(Date.now() + 24 * 3600000)}, "leaseUntil" = NULL WHERE "key" = ${key}`;
    return route;
  } catch (error) {
    await db.$executeRaw`UPDATE "RoadRouteCache" SET "result" = NULL, "expiresAt" = ${new Date(Date.now() + 60000)}, "leaseUntil" = NULL WHERE "key" = ${key}`;
    if (error instanceof RoutingError) throw error;
    throw new RoutingError('ROUTE_PROVIDER', 'Road directions could not load. Check your connection and retry.');
  }
}
