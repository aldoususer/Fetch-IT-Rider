'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { GOOGLE_MAP_FAILURE, loadRiderGoogleMaps } from '@/lib/rider-google-maps';
import { googleRiderMap, standardRiderMap, type RiderMap } from '@/lib/rider-map-renderer';
import type { RoadRoute, RoutePoint } from '@/lib/road-routing';

export function useRiderJobMap(host: RefObject<HTMLDivElement | null>, pickup: RoutePoint, dropoff: RoutePoint, road: RoadRoute | null, rider: RoutePoint | null, valid: boolean) {
  const adapter = useRef<RiderMap | null>(null), latest = useRef({ road, rider });
  const [state, setState] = useState<'loading' | 'google' | 'standard' | 'error'>('loading');
  useEffect(() => { latest.current.road = road; adapter.current?.route(road); }, [road]);
  useEffect(() => { latest.current.rider = rider; adapter.current?.rider(rider); }, [rider?.lat, rider?.lng]);
  useEffect(() => {
    const element = host.current;
    if (!valid || !element) return;
    let disposed = false, started = false, fallingBack = false;
    const controller = new AbortController();
    const sync = () => { adapter.current?.route(latest.current.road); adapter.current?.rider(latest.current.rider); };
    const fallback = async () => {
      if (disposed || fallingBack) return;
      fallingBack = true; adapter.current?.destroy(); adapter.current = null;
      try {
        const L = await import('leaflet');
        if (disposed) return;
        adapter.current = standardRiderMap(element, L, pickup, dropoff, () => { if (!disposed) setState('error'); });
        sync(); setState('standard');
      } catch { if (!disposed) setState('error'); }
    };
    const start = async () => {
      if (disposed || started) return;
      started = true;
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch('/api/rider/map-session', { method: 'POST', signal: controller.signal });
        const data = await response.json();
        if (disposed) return;
        if (!response.ok || data.provider !== 'google' || typeof data.key !== 'string') { await fallback(); return; }
        const sdk = await loadRiderGoogleMaps(data.key);
        if (disposed || fallingBack) return;
        adapter.current = googleRiderMap(element, sdk, pickup, dropoff);
        sync(); setState('google');
      } catch { if (!disposed) await fallback(); }
      finally { clearTimeout(timer); }
    };
    const failed = () => { void fallback(); };
    window.addEventListener(GOOGLE_MAP_FAILURE, failed);
    const resize = new ResizeObserver(() => adapter.current?.resize()); resize.observe(element);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); void start(); } }, { rootMargin: '100px' });
    if (observer) observer.observe(element); else void start();
    return () => { disposed = true; controller.abort(); observer?.disconnect(); resize.disconnect(); window.removeEventListener(GOOGLE_MAP_FAILURE, failed); adapter.current?.destroy(); adapter.current = null; };
    // Route, GPS, stage and resize updates must not create billable maps.
  }, [host, pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, valid]);
  return { state, zoom: (change: number) => adapter.current?.zoom(change), center: () => { if (latest.current.rider) adapter.current?.center(latest.current.rider); } };
}
