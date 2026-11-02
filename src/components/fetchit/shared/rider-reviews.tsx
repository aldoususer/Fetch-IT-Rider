"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type Review = { id: string; rating: number; comment: string | null; createdAt: string; service: string };
type Page = { reviews: Review[]; nextCursor: string | null };
export function RiderReviews({ endpoint }: { endpoint: string }) {
  const [reviews, setReviews] = useState<Review[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const pending = useRef(false), controller = useRef<AbortController | null>(null), generation = useRef(0);
  const load = useCallback(async (next: string | null, first = false) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    const version = generation.current, abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch(endpoint + (next ? '?cursor=' + encodeURIComponent(next) : ''), { cache: 'no-store', signal: abort.signal });
      const data = await response.json() as Page & { error?: string };
      if (!response.ok || !Array.isArray(data.reviews)) {
        if (response.status === 400 && next && !abort.signal.aborted && version === generation.current) { setLoaded(false); setCursor(null); }
        throw new Error(data.error || 'Reviews could not load. Please retry.');
      }
      if (abort.signal.aborted || version !== generation.current) return;
      setReviews(previous => first ? data.reviews : [...previous, ...data.reviews.filter(item => !previous.some(saved => saved.id === item.id))]);
      setCursor(data.nextCursor); setLoaded(true);
    } catch (failure) { if (!abort.signal.aborted && version === generation.current) setError(failure instanceof Error ? failure.message : 'Reviews could not load. Please retry.'); }
    finally { if (version === generation.current) { pending.current = false; setBusy(false); } }
  }, [endpoint]);
  useEffect(() => {
    generation.current++; pending.current = false;
    let active = true;
    queueMicrotask(() => { if (active) { setReviews([]); setCursor(null); setLoaded(false); void load(null, true); } });
    return () => { active = false; generation.current++; controller.current?.abort(); pending.current = false; };
  }, [load, attempt]);
  return <div className="space-y-3" aria-busy={busy}>
    <h4 className="font-semibold">Customer reviews</h4>
    {loaded && !reviews.length && <p className="text-sm text-muted-foreground">No customer reviews yet. Ratings appear after completed bookings.</p>}
    <ul className="space-y-3">{reviews.map(review => <li key={review.id} className="rounded-xl border p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><strong aria-label={`${review.rating} out of 5 stars`}><span aria-hidden="true" className="text-amber-600">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span> {review.rating}/5</strong><span className="text-xs text-muted-foreground">{review.service === 'RIDE' ? 'Passenger ride' : 'Delivery'}</span></div>
      {review.comment?.trim() ? <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{review.comment}</p> : <p className="text-sm text-muted-foreground">Rating only · no written comment</p>}
      <time className="block text-xs text-muted-foreground" dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })}</time>
    </li>)}</ul>
    {busy && <p role="status" className="text-sm text-muted-foreground">Loading reviews…</p>}
    {error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" className="min-h-12" disabled={busy} onClick={() => loaded ? void load(cursor) : setAttempt(value => value + 1)}>Retry reviews</Button></div>}
    {loaded && cursor && !error && <Button type="button" variant="outline" className="min-h-12 w-full" disabled={busy} onClick={() => void load(cursor)}>{busy ? 'Loading…' : 'Show more reviews'}</Button>}
  </div>;
}
