"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { RoadDirections } from './road-directions';
import { validRoutePoint, type RoadRoute, type RoutePoint } from '@/lib/road-routing';
import { useAppStore } from '@/lib/store';
import { useRiderJobMap } from '@/hooks/use-rider-job-map';
import { Button } from '@/components/ui/button';

type Fix = RoutePoint & { accuracy: number; at: number };
export function JobRouteMap({ pickup, dropoff, navigation = 'pickup', bookingId, stage = 'PENDING' }: { pickup: RoutePoint; dropoff: RoutePoint; navigation?: 'pickup' | 'dropoff' | 'none'; bookingId?: string; stage?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const routingAvailable = useAppStore(state => !!state.user?.roadRouting);
  const [road, setRoad] = useState<{ stage: string; route: RoadRoute | null } | null>(null);
  const [fix, setFix] = useState<Fix | null>(null), [now, setNow] = useState(0), [expanded, setExpanded] = useState(false);
  const onRoute = useCallback((route: RoadRoute | null) => setRoad({ stage, route }), [stage]);
  useEffect(() => {
    const location = (event: Event) => setFix((event as CustomEvent<Fix>).detail);
    const timer = setInterval(() => setNow(Date.now()), 5000);
    window.addEventListener('fetchit:rider-location', location);
    return () => { clearInterval(timer); window.removeEventListener('fetchit:rider-location', location); };
  }, []);
  const clock = now || Date.now();
  const fresh = fix && validRoutePoint(fix) && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= 75 && clock - fix.at <= 30000 && fix.at - clock <= 5000 ? fix : null;
  const valid = validRoutePoint(pickup) && validRoutePoint(dropoff);
  const map = useRiderJobMap(container, pickup, dropoff, road?.stage === stage ? road.route : null, fresh, valid);
  const directions = (to: RoutePoint) => `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=driving`;
  return <section className="min-w-0 space-y-2" aria-label="Job route map">
    {valid ? <>
      <div className={`relative z-0 ${expanded ? 'h-[420px]' : 'h-[220px] sm:h-[280px]'} w-full overflow-hidden rounded-xl border bg-white`} aria-busy={map.state === 'loading'}>
        <div ref={container} className="absolute inset-0" role="region" aria-label="Street map with pickup and drop-off markers" />
        {map.state === 'loading' && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-white/90 text-sm" role="status">Loading map…</div>}
        {(map.state === 'google' || map.state === 'standard') && <div className="absolute right-2 top-2 grid gap-1" aria-label="Map zoom"><Button className="min-h-12 min-w-12 bg-white text-foreground" variant="outline" aria-label="Zoom in" onClick={() => map.zoom(1)}>+</Button><Button className="min-h-12 min-w-12 bg-white text-foreground" variant="outline" aria-label="Zoom out" onClick={() => map.zoom(-1)}>−</Button></div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground" role="status">{map.state === 'google' ? 'Google Maps' : map.state === 'standard' ? 'Standard map · Directions remain available' : map.state === 'error' ? 'Map unavailable. Use the navigation links.' : 'Preparing map'}</span><div className="flex gap-1">{fresh && <Button className="min-h-12" variant="ghost" onClick={map.center}>Centre on me</Button>}<Button className="min-h-12" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Collapse map' : 'Expand map'}</Button></div></div>
      {bookingId && routingAvailable && <RoadDirections key={bookingId + stage} bookingId={bookingId} stage={stage} onRoute={onRoute} />}
      {road?.stage === stage && road.route && <p className="text-xs text-muted-foreground">Route data © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> via openrouteservice.</p>}
      {navigation !== 'none' && <div className="rd-navigation"><a className="rd-navigation-primary" target="_blank" rel="noopener noreferrer" href={directions(navigation === 'pickup' ? pickup : dropoff)}>Navigate to {navigation === 'pickup' ? 'pickup' : 'drop-off'} ↗</a><a className="rd-navigation-secondary" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/dir/?api=1&origin=${pickup.lat},${pickup.lng}&destination=${dropoff.lat},${dropoff.lng}&travelmode=driving`}>View full route ↗</a></div>}
    </> : <p className="text-sm text-muted-foreground">Map unavailable: booking coordinates are missing.</p>}
  </section>;
}