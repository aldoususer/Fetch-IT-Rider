"use client";
import { useEffect, useRef, useState } from "react";

type Point = { lat: number; lng: number };
export function JobRouteMap({ pickup, dropoff }: { pickup: Point; dropoff: Point }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const valid = [pickup, dropoff].every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
  useEffect(() => {
    if (!valid || !container.current) return;
    let disposed = false;
    let map: import('leaflet').Map | undefined;
    let resize: ResizeObserver | undefined;
    setError(false);
    void import('leaflet').then(L => {
      if (disposed || !container.current) return;
      map = L.map(container.current, { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).on('tileerror', () => { if (!disposed) setError(true); }).addTo(map);
      const points: [number, number][] = [[pickup.lat, pickup.lng], [dropoff.lat, dropoff.lng]];
      for (const [index, point] of points.entries()) {
        const label = index === 0 ? 'Pickup' : 'Drop-off';
        const icon = L.divIcon({ className: '', html: `<span style="display:block;width:30px;height:30px;border:3px solid white;border-radius:50%;background:${index === 0 ? '#059669' : '#e11d48'};color:white;text-align:center;line-height:24px;font-weight:bold;box-shadow:0 2px 8px #0005">${index === 0 ? 'P' : 'D'}</span>`, iconSize:[30,30], iconAnchor:[15,15] });
        L.marker(point, { icon, title: label }).bindTooltip(label).addTo(map);
      }
      map.fitBounds(L.latLngBounds(points), { padding: [38,38], maxZoom:16 });
      resize = new ResizeObserver(() => { map?.invalidateSize(); map?.fitBounds(L.latLngBounds(points), { padding: [38,38], maxZoom:16 }); });
      resize.observe(container.current);
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; resize?.disconnect(); map?.remove(); };
  }, [pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, valid]);
  const directions = (to: Point) => `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=driving`;
  return <section className="min-w-0 space-y-2" aria-label="Job route map">
    {valid ? <><div ref={container} className="relative z-0 h-[260px] sm:h-[320px] w-full rounded-xl border overflow-hidden" role="region" aria-label="Street map with pickup and drop-off markers" />
      {error && <p role="status" className="text-xs text-muted-foreground">Map tiles could not load. Use the navigation links below.</p>}
      <div className="flex flex-wrap gap-2 text-sm"><a className="rounded-lg border px-3 py-2 hover:bg-muted" target="_blank" rel="noopener noreferrer" href={directions(pickup)}>Navigate to pickup</a><a className="rounded-lg border px-3 py-2 hover:bg-muted" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/dir/?api=1&origin=${pickup.lat},${pickup.lng}&destination=${dropoff.lat},${dropoff.lng}&travelmode=driving`}>Pickup to drop-off route</a></div>
    </> : <p className="text-sm text-muted-foreground">Map unavailable: booking coordinates are missing.</p>}
  </section>;
}

