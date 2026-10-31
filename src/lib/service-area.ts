import coverage from "../../public/service-area-data.json";

type Point = { lat: number; lng: number };
type Polygon = { bounds: number[]; rings: string[] };
export type ServiceAreaIssue = "invalid" | "outside" | "water";

const decodedRings = new Map<string, number[][]>();
function decodeRing(encoded: string): number[][] {
  const cached = decodedRings.get(encoded);
  if (cached) return cached;
  const result: number[][] = [];
  const position = [0, 0];
  let index = 0;
  while (index < encoded.length) {
    for (let axis = 0; axis < 2; axis++) {
      let value = 0, shift = 0, byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        value |= (byte & 31) << shift;
        shift += 5;
      } while (byte >= 32);
      position[axis] += (value & 1) ? ~(value >>> 1) : value >>> 1;
    }
    result.push([position[0] / 1e6, position[1] / 1e6]);
  }
  decodedRings.set(encoded, result);
  return result;
}

// GeoJSON order is longitude, latitude. Keep holes (islands in lakes) and
// separate polygons intact; a rectangular province extent is not coverage.
function ringContains(point: Point, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [px, py] = ring[j];
    const cross = (point.lng - x) * (py - y) - (point.lat - y) * (px - x);
    if (Math.abs(cross) < 1e-12 && point.lng >= Math.min(x, px) && point.lng <= Math.max(x, px) && point.lat >= Math.min(y, py) && point.lat <= Math.max(y, py)) return true;
    if ((y > point.lat) !== (py > point.lat) && point.lng < (px - x) * (point.lat - y) / (py - y) + x) inside = !inside;
  }
  return inside;
}

function contains(point: Point, polygon: Polygon): boolean {
  const [west, south, east, north] = polygon.bounds;
  return point.lng >= west && point.lng <= east && point.lat >= south && point.lat <= north
    && ringContains(point, decodeRing(polygon.rings[0]))
    && !polygon.rings.slice(1).some(ring => ringContains(point, decodeRing(ring)));
}

export function serviceAreaIssue(value: unknown): ServiceAreaIssue | null {
  if (!value || typeof value !== "object") return "invalid";
  const point = value as Point;
  if (typeof point.lat !== "number" || typeof point.lng !== "number" || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return "invalid";
  if (!coverage.land.some(polygon => contains(point, polygon))) return "outside";
  if (coverage.water.some(polygon => contains(point, polygon))) return "water";
  return null;
}

export function serviceAreaMessage(issue: ServiceAreaIssue | null, location = "this location"): string | null {
  if (!issue) return null;
  if (issue === "invalid") return `Choose a valid ${location === "this location" ? "location" : `${location} location`}.`;
  return `Area unavailable for ${location}. ${issue === "water" ? "Choose a point on land" : "Choose a location within Pangasinan"}.`;
}

export function bookingServiceAreaError(pickup: unknown, dropoff: unknown): string | null {
  return serviceAreaMessage(serviceAreaIssue(pickup), "pickup") ?? serviceAreaMessage(serviceAreaIssue(dropoff), "drop-off");
}
