import type { RoadRoute, RoutePoint } from './road-routing';
type Point = RoutePoint;
type GoogleMap = { fitBounds(bounds: unknown, padding?: number): void; getZoom(): number | undefined; setZoom(zoom: number): void; panTo(point: Point): void };
type GoogleMarker = { setPosition(point: Point): void; setMap(map: GoogleMap | null): void };
type GoogleLine = { setPath(points: Point[]): void; setMap(map: GoogleMap | null): void };
export type GoogleSDK = {
  Map: new (host: HTMLElement, options: object) => GoogleMap;
  Marker: new (options: object) => GoogleMarker;
  Polyline: new (options: object) => GoogleLine;
  LatLngBounds: new () => { extend(point: Point): void };
  SymbolPath: { CIRCLE: unknown };
  event: { clearInstanceListeners(target: unknown): void };
};
export type RiderMap = { route(value: RoadRoute | null): void; rider(value: Point | null): void; resize(): void; zoom(change: number): void; center(point: Point): void; destroy(): void };
export function googleRiderMap(host: HTMLElement, sdk: GoogleSDK, pickup: Point, dropoff: Point): RiderMap {
  // Only constructor: route, GPS and resize updates reuse this map.
  const map = new sdk.Map(host, { center: pickup, zoom: 13, disableDefaultUI: true, gestureHandling: 'cooperative', clickableIcons: false, streetViewControl: false, fullscreenControl: false, mapTypeControl: false, colorScheme: 'LIGHT' });
  const markers = [pickup, dropoff].map((position, i) => new sdk.Marker({ position, map, title: i ? 'Drop-off' : 'Pickup', label: { text: i ? 'D' : 'P', color: '#fff', fontWeight: '700' } }));
  const line = new sdk.Polyline({ map, path: [], strokeColor: '#b94717', strokeOpacity: .95, strokeWeight: 5 });
  let rider: GoogleMarker | undefined, path = [pickup, dropoff];
  const fit = () => { const bounds = new sdk.LatLngBounds(); path.forEach(point => bounds.extend(point)); map.fitBounds(bounds, 42); };
  fit();
  return {
    route(value) { path = value ? value.coordinates.map(([lng, lat]) => ({ lat, lng })) : [pickup, dropoff]; line.setPath(value ? path : []); fit(); },
    rider(point) { if (!point) { rider?.setMap(null); rider = undefined; return; } if (rider) rider.setPosition(point); else rider = new sdk.Marker({ position: point, map, title: 'Your shared location', zIndex: 10, icon: { path: sdk.SymbolPath.CIRCLE, fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3, scale: 8 } }); },
    resize: fit,
    zoom(change) { map.setZoom(Math.max(3, Math.min(20, (map.getZoom() ?? 13) + change))); },
    center(point) { map.panTo(point); },
    destroy() { markers.forEach(marker => marker.setMap(null)); rider?.setMap(null); line.setMap(null); sdk.event.clearInstanceListeners(map); host.replaceChildren(); },
  };
}
export function standardRiderMap(host: HTMLElement, L: typeof import('leaflet'), pickup: Point, dropoff: Point, onError: () => void): RiderMap {
  const map = L.map(host, { scrollWheelZoom: false, zoomControl: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).on('tileerror', onError).addTo(map);
  [pickup, dropoff].forEach((point, i) => {
    const icon = L.divIcon({ className: '', html: `<span style="display:block;margin:9px;width:30px;height:30px;border:3px solid white;border-radius:50%;background:${i ? '#e11d48' : '#059669'};color:white;text-align:center;line-height:24px;font-weight:bold">${i ? 'D' : 'P'}</span>`, iconSize: [48, 48], iconAnchor: [24, 24] });
    L.marker([point.lat, point.lng], { icon, title: i ? 'Drop-off' : 'Pickup' }).addTo(map);
  });
  let points: [number, number][] = [[pickup.lat, pickup.lng], [dropoff.lat, dropoff.lng]];
  const line = L.polyline([], { color: '#b94717', weight: 5, opacity: .95 }).addTo(map);
  let rider: import('leaflet').CircleMarker | undefined;
  const fit = () => { map.invalidateSize(); map.fitBounds(L.latLngBounds(points), { padding: [38, 38], maxZoom: 16 }); };
  fit();
  return {
    route(value) { points = value ? value.coordinates.map(([lng, lat]) => [lat, lng]) : [[pickup.lat, pickup.lng], [dropoff.lat, dropoff.lng]]; line.setLatLngs(value ? points : []); fit(); },
    rider(point) { if (!point) { rider?.remove(); rider = undefined; } else if (rider) rider.setLatLng([point.lat, point.lng]); else rider = L.circleMarker([point.lat, point.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map); },
    resize: fit, zoom(change) { map.setZoom(Math.max(3, Math.min(19, map.getZoom() + change))); }, center(point) { map.panTo([point.lat, point.lng]); }, destroy() { map.remove(); host.replaceChildren(); },
  };
}
