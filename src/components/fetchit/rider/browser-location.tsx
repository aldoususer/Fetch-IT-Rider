"use client";
import { useEffect, useRef, useState } from "react";
import { rememberRiderLocation, clearRiderLocation } from "@/lib/rider-location-client";
import { Button } from "@/components/ui/button";

type Fix = { lat: number; lng: number; accuracy: number; at: number; speedKph?: number; heading?: number };

export function BrowserLocation({ userId, needed, availabilityKnown = true }: { userId: string; needed: boolean; availabilityKnown?: boolean }) {
  const enabled = needed;
  const [fix, setFix] = useState<Fix | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(0);
  const latest = useRef<Fix | null>(null);
  useEffect(() => {
    if (!enabled || !needed) return;
    if (!window.isSecureContext || !navigator.geolocation) return;
    const controller = new AbortController();
    let busy = false;
    let lastSentFix = 0;
    let lastAttempt = 0;
    latest.current = null;
    async function publish() {
      const point = latest.current;
      if (busy || document.hidden || !navigator.onLine || !point || Date.now() - point.at > 30_000 || point.at <= lastSentFix || Date.now() - lastAttempt < 5000) return;
      busy = true; lastAttempt = Date.now();
      try {
        const response = await fetch("/api/rider/location", { method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...point, capturedAt: point.at }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Couldn’t share location. Retrying…");
        if (!controller.signal.aborted) { lastSentFix = point.at; setSentAt(Date.now()); setError(""); window.dispatchEvent(new CustomEvent("fetchit:rider-location", { detail: point })); }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn’t share location. Retrying…"); }
      finally { busy = false; }
    }
    const capture = (position: GeolocationPosition) => {
      if (controller.signal.aborted) return;
      const coords = position.coords;
      if (![coords.latitude, coords.longitude, coords.accuracy].every(Number.isFinite) || Date.now() - position.timestamp > 30_000) return;
      if (coords.accuracy > 100) { clearRiderLocation(userId); setError('Location is too approximate. Move outdoors and retry.'); return; }
      const point: Fix = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, at: position.timestamp,
        ...(coords.speed != null && coords.speed >= 0 ? { speedKph: coords.speed * 3.6 } : {}),
        ...(coords.heading != null && Number.isFinite(coords.heading) ? { heading: coords.heading } : {}) };
      rememberRiderLocation(userId, { lat: point.lat, lng: point.lng, accuracy: point.accuracy, capturedAt: point.at });
      latest.current = point; setFix(point); void publish();
    };
    const onError = (failure: GeolocationPositionError) => {
      if (controller.signal.aborted) return;
      clearRiderLocation(userId); latest.current = null; setFix(null); setSentAt(null);
      setError(failure.code === 1 ? "Location permission denied. Allow location in your browser’s site settings, then retry." : failure.code === 2 ? "Your device could not determine its location. Turn on location services and retry." : "Location timed out. Move near a window or outdoors and retry.");
    };
    const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };
    const watch = navigator.geolocation.watchPosition(capture, onError, options);
    const timer = setInterval(() => {
      setNow(Date.now());
      if (!document.hidden && navigator.onLine) navigator.geolocation.getCurrentPosition(capture, onError, options);
    }, 10000);
    const resume = () => { setNow(Date.now()); if (!document.hidden && navigator.onLine) navigator.geolocation.getCurrentPosition(capture, onError, options); };
    document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume);
    return () => { clearRiderLocation(userId); controller.abort(); navigator.geolocation.clearWatch(watch); clearInterval(timer); latest.current = null;
      document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
  }, [enabled, needed, retry, userId]);
  const fresh = needed && enabled && fix && Math.max(now, Date.now()) - fix.at <= 30_000;
  const issueLabel = /permission denied/i.test(error) ? 'Location is blocked'
    : /timed out/i.test(error) ? 'Location timed out'
    : /approximate/i.test(error) ? 'Location too approximate'
    : /determine/i.test(error) ? 'GPS unavailable' : 'Location could not be shared';
  return <details className="rd-location" aria-label="Browser location sharing">
    <summary><span className={fresh && sentAt ? 'rd-gps-dot is-sharing' : 'rd-gps-dot'} aria-hidden="true"/><strong>{!availabilityKnown ? 'Checking location…' : error ? issueLabel : !needed ? 'Location inactive' : !enabled ? 'Location sharing off' : fresh && sentAt ? 'Location shared' : 'Finding your location…'}</strong><span className="rd-location-expand">{error ? 'Fix location' : 'Details'}</span></summary>
    <div className="rd-location-body space-y-3">
    <p className="text-sm" role="status">{!availabilityKnown ? 'Checking your availability.' : !needed ? 'Location is required to receive offers.' : error || (!fix ? 'Finding your location…' : !fresh ? 'Open Rider to refresh your location and resume offers.' : sentAt ? 'Shared for nearby offers and active jobs.' : 'Sharing location…')}</p>
    {fresh && <div className="text-sm space-y-1"><a className="underline underline-offset-4" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${fix.lat}&mlon=${fix.lng}#map=17/${fix.lat}/${fix.lng}`}>{fix.lat.toFixed(6)}, {fix.lng.toFixed(6)} · View on map</a><p className="text-xs text-muted-foreground">Device accuracy: ±{Math.round(fix.accuracy)} m{fix.accuracy > 100 ? " · Approximate location; move outdoors for better accuracy." : ""}</p>{sentAt && <p className="text-xs text-muted-foreground">Last shared {new Date(sentAt).toLocaleTimeString()}</p>}</div>}
    {enabled && error && <Button size="sm" variant="outline" onClick={() => { setError(""); setFix(null); setSentAt(null); setRetry(value => value + 1); }}>Retry location</Button>}
    {needed && !error && <p className="text-xs text-muted-foreground">Keep Rider open to keep sharing location.</p>}
    </div>
  </details>;
}
