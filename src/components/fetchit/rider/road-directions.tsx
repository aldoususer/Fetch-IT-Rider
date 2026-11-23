'use client';
import { planningTravelSeconds, travelTimeRange } from '@/lib/eta-policy';
import { startBookingTiming } from '@/lib/booking-client-timing';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { routeProgress, type RoadRoute, type RoutePoint } from '@/lib/road-routing';

type Fix = RoutePoint & { accuracy: number; at: number };
export function RoadDirections({ bookingId, stage, vehicleClass = 'SEDAN', onRoute }: { bookingId: string; stage: string; vehicleClass?: string; onRoute: (route: RoadRoute | null, alternative?: RoadRoute | null, onCompare?: () => void) => void }) {
  const [route, setRoute] = useState<RoadRoute | null>(null), [error, setError] = useState('');
  const [alternative, setAlternative] = useState<RoadRoute | null>(null);
  const [comparing, setComparing] = useState(false);
  const compareButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false), [offline, setOffline] = useState(false), [fix, setFix] = useState<Fix | null>(null), [now, setNow] = useState(0);
  const pending = useRef(false), request = useRef(0), lastAttempt = useRef(0), deviations = useRef(0), abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const location = (event: Event) => setFix((event as CustomEvent<Fix>).detail);
    const connection = () => setOffline(!navigator.onLine);
    const timer = setInterval(() => setNow(Date.now()), 5000);
    connection(); window.addEventListener('fetchit:rider-location', location); window.addEventListener('online', connection); window.addEventListener('offline', connection);
    return () => { request.current++; abort.current?.abort(); clearInterval(timer); window.removeEventListener('fetchit:rider-location', location); window.removeEventListener('online', connection); window.removeEventListener('offline', connection); };
  }, []);
  function publish(selected: RoadRoute, alternate: RoadRoute | null) {
    setRoute(selected); setAlternative(alternate); setComparing(false);
    onRoute(selected, alternate, alternate ? () => setComparing(true) : undefined);
    deviations.current = 0;
  }
  async function load() {
    if (pending.current || !navigator.onLine) return;
    pending.current = true; setBusy(true); setError(''); lastAttempt.current = Date.now();
    const generation = ++request.current, controller = new AbortController(); abort.current = controller;
    const timing = startBookingTiming("road_route");
    let outcome: "confirmed" | "failed" | "superseded" = "failed";
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/route`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', ...timing.headers }, body: '{}' });
      timing.response(response);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.route) throw new Error(data?.error || 'Route could not load. Please retry.');
      if (generation !== request.current) { outcome = "superseded"; return; }
      outcome = "confirmed";
      publish(data.route, data.alternative ?? null);
    } catch (failure) {
      if (generation === request.current) setError(controller.signal.aborted ? 'Route took too long to load. Please retry.' : failure instanceof Error ? failure.message : 'Route unavailable.');
    } finally { timing.finish(outcome); clearTimeout(timeout); if (generation === request.current) { pending.current = false; setBusy(false); } }
  }
  const progress = route && fix && !offline ? routeProgress(route, fix, now || Date.now()) : null;
  useEffect(() => {
    if (!route || !progress || offline) return;
    deviations.current = progress.offRoute ? deviations.current + 1 : 0;
    // Only distinct, freshly published GPS fixes count. A timer tick cannot
    // manufacture another deviation or consume another provider request.
    if (!comparing && deviations.current >= 2 && Date.now() - lastAttempt.current >= 90000) void load();
  }, [fix?.at]);
  const current = route && progress && !progress.offRoute ? route.steps[progress.stepIndex] : null;
  const next = route && progress ? route.steps[progress.stepIndex + 1] : null;
  const estimate = (path: RoadRoute) => planningTravelSeconds(path.distanceMeters, path.durationSeconds, vehicleClass);
  const formatDistance = (meters: number) => (meters / 1000).toFixed(2) + ' km';
  const timeDifference = route && alternative ? estimate(alternative) - estimate(route) : 0;
  const minutesDifference = Math.round(Math.abs(timeDifference) / 60);
  const distanceDifference = route && alternative ? alternative.distanceMeters - route.distanceMeters : 0;
  return <section className="rd-directions" aria-label="Road directions" aria-busy={busy}>
    <div className="rd-directions-heading"><strong>{'Route to ' + (stage === 'ACCEPTED' ? 'pickup' : 'drop-off')}</strong><Button className="min-h-12" variant="outline" disabled={busy || offline} onClick={()=>void load()}>{busy ? 'Loading route…' : route ? 'Refresh route' : 'Load route'}</Button></div>
    {offline && <p role="status">You’re offline. Saved directions may be outdated.</p>}
    {error && <p role="status">{error} You can still use the external navigation link.</p>}
    {route && <>
      <p>{(route.distanceMeters / 1000).toFixed(2)} km · Estimated {travelTimeRange(planningTravelSeconds(route.distanceMeters, route.durationSeconds, vehicleClass))} min <span className="rd-help">· Planning estimate, no live traffic</span></p>
      {alternative && <Button ref={compareButton} className="min-h-12" variant="outline" disabled={busy} onClick={() => setComparing(true)}>Compare alternate route</Button>}
      <div className="rd-current-stop" aria-live="polite">{progress?.offRoute ? <><strong>You appear to be off route</strong><p>{busy ? 'Updating directions…' : 'Refresh the route when it is safe to do so.'}</p></> : progress?.arrived ? <><strong>You’re near the destination</strong><p>Confirm the address before marking arrival. Navigation does not update the booking.</p></> : current ? <><strong>{current.instruction}</strong><p>{next ? `In about ${progress!.toTurnMeters} m: ${next.instruction}` : `${progress!.remainingMeters} m remaining`}</p></> : <p>Waiting for a fresh, accurate shared location. Directions below remain available.</p>}</div>
      <details><summary>All turn instructions</summary><ol>{route.steps.map((step, i)=><li key={i}><span>{step.instruction}</span><small>{step.distance >= 1000 ? (step.distance / 1000).toFixed(1) + ' km' : Math.round(step.distance) + ' m'}</small></li>)}</ol></details>
      <p className="rd-help">Road guidance uses a car profile; motorcycle and tricycle access rules may differ. Follow road signs and your approved operating area.</p>
      <a className="rd-routing-credit" href="https://openrouteservice.org/" target="_blank" rel="noreferrer">Directions © openrouteservice / HeiGIT</a>
    </>}
    {route && alternative && <Dialog open={comparing} onOpenChange={setComparing}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); compareButton.current?.focus({ preventScroll: true }); }}>
        <DialogHeader>
          <DialogTitle>Switch to this route?</DialogTitle>
          <DialogDescription>Estimates exclude live traffic. Your fare stays the same.</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><dt>Current route</dt><dd>{formatDistance(route.distanceMeters)} · {travelTimeRange(estimate(route))} min</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt>Yellow route</dt><dd>{formatDistance(alternative.distanceMeters)} · {travelTimeRange(estimate(alternative))} min</dd></div>
        </dl>
        <p className="font-medium">{minutesDifference === 0 ? 'About the same travel time' : `About ${minutesDifference} min ${timeDifference < 0 ? 'faster' : 'slower'}`} · {Math.abs(distanceDifference) < 5 ? 'About the same distance' : `${formatDistance(Math.abs(distanceDifference))} ${distanceDifference < 0 ? 'shorter' : 'longer'}`}</p>
        <DialogFooter>
          <Button variant="outline" className="min-h-12" onClick={() => setComparing(false)}>Keep current route</Button>
          <Button className="min-h-12" disabled={busy} onClick={() => {
            if (pending.current) return;
            lastAttempt.current = Date.now();
            publish(alternative, route);
          }}>Switch route</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>}
    {!route && !busy && !error && <p className="rd-help">Traffic shown where available.</p>}
  </section>;
}
