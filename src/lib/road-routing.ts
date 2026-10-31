export type RoutePoint = { lat: number; lng: number };
export type RoadStep = { instruction: string; distance: number; duration: number; start: number; end: number; type: number };
export type RoadRoute = {
  source: 'openrouteservice'; profile: 'driving-car'; distanceMeters: number; durationSeconds: number;
  coordinates: [number, number][]; steps: RoadStep[]; computedAt: string;
};
export class RoutingError extends Error {
  constructor(public code: string, message: string, public status = 503) { super(message); }
}
export function routeOptions(vehicle: string) {
  if (!['MOTORCYCLE', 'TRICYCLE', 'SEDAN'].includes(vehicle)) throw new RoutingError('ROUTE_VEHICLE', 'Routing is unavailable for this vehicle.', 422);
  // ORS has no motorcycle/tricycle profile. Use conservative road routing,
  // never cycling shortcuts; local restrictions still need rider judgement.
  return { avoid_features: vehicle === 'SEDAN' ? ['ferries'] : ['ferries', 'highways', 'tollways'] };
}
export function validRoutePoint(value: unknown): value is RoutePoint {
  const point = value as RoutePoint | null;
  return !!point && typeof point.lat === 'number' && typeof point.lng === 'number' && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}
export function distanceMeters(a: RoutePoint, b: RoutePoint) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2)));
}
type OrsResponse = { features?: { geometry?: { type?: string; coordinates?: unknown }; properties?: { summary?: { distance?: number; duration?: number }; segments?: { steps?: { instruction?: string; distance?: number; duration?: number; way_points?: number[]; type?: number }[] }[] } }[] };
export function parseRoadRoute(body: unknown, start: RoutePoint, finish: RoutePoint, now = Date.now()): RoadRoute {
  const feature = (body as OrsResponse)?.features?.[0], coordinates = feature?.geometry?.coordinates;
  const summary = feature?.properties?.summary;
  const invalid = () => new RoutingError('ROUTE_RESPONSE', 'Road directions could not be loaded. Please retry.');
  if (feature?.geometry?.type !== 'LineString' || !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 50000 ||
    coordinates.some(p => !Array.isArray(p) || p.length < 2 || !validRoutePoint({ lat: p[1], lng: p[0] })) ||
    !summary || !Number.isFinite(summary.distance) || !Number.isFinite(summary.duration) || summary.distance! < 0 || summary.distance! > 1000000 || summary.duration! < 0 || summary.duration! > 604800) throw invalid();
  const points = coordinates.map(p => [p[0], p[1]] as [number, number]);
  const point = (i: number) => ({ lat: points[i][1], lng: points[i][0] });
  // Avoid silently snapping a pin across a river or to a distant highway.
  if (distanceMeters(start, point(0)) > 200 || distanceMeters(finish, point(points.length - 1)) > 200) throw new RoutingError('ROUTE_SNAP', 'Choose a pickup and drop-off closer to an accessible road.', 422);
  const raw = feature.properties?.segments?.flatMap(segment => segment.steps ?? []) ?? [];
  if (!raw.length || raw.length > 2000) throw invalid();
  const steps = raw.map(step => {
    const [from, to] = step.way_points ?? [];
    if (typeof step.instruction !== 'string' || !step.instruction.trim() || step.instruction.length > 1000 ||
      !Number.isFinite(step.distance) || step.distance! < 0 || !Number.isFinite(step.duration) || step.duration! < 0 ||
      !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= points.length) throw invalid();
    return { instruction: step.instruction, distance: step.distance!, duration: step.duration!, start: from, end: to, type: step.type ?? 0 };
  });
  return { source: 'openrouteservice', profile: 'driving-car', distanceMeters: summary.distance!, durationSeconds: summary.duration!, coordinates: points, steps, computedAt: new Date(now).toISOString() };
}
export function routeProgress(route: RoadRoute, fix: RoutePoint & { accuracy: number; at: number }, now = Date.now()) {
  if (!validRoutePoint(fix) || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 75 || !Number.isFinite(fix.at) || now - fix.at > 30000 || fix.at - now > 5000) return null;
  const scale = Math.cos(fix.lat * Math.PI / 180), metres = 111195;
  let closest = Infinity, index = 0, fraction = 0;
  for (let i = 0; i < route.coordinates.length - 1; i++) {
    const a = route.coordinates[i], b = route.coordinates[i + 1];
    const ax = (a[0] - fix.lng) * scale * metres, ay = (a[1] - fix.lat) * metres;
    const dx = (b[0] - a[0]) * scale * metres, dy = (b[1] - a[1]) * metres;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const distance = Math.hypot(ax + t * dx, ay + t * dy);
    if (distance < closest) { closest = distance; index = i; fraction = t; }
  }
  const stepIndex = Math.max(0, route.steps.findIndex(step => step.end > index));
  const step = route.steps[stepIndex];
  let remaining = 0, toTurn = 0;
  for (let i = index; i < route.coordinates.length - 1; i++) {
    const a = route.coordinates[i], b = route.coordinates[i + 1];
    const length = distanceMeters({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] }) * (i === index ? 1 - fraction : 1);
    remaining += length; if (i < step.end) toTurn += length;
  }
  return { stepIndex, remainingMeters: Math.round(remaining), toTurnMeters: Math.round(toTurn), offRoute: closest > Math.max(75, fix.accuracy * 2), arrived: distanceMeters(fix, { lat: route.coordinates.at(-1)![1], lng: route.coordinates.at(-1)![0] }) <= Math.max(25, fix.accuracy) };
}
