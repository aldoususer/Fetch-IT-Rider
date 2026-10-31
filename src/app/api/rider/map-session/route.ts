import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireRider, riderErrorResponse } from '@/lib/rider-access';
import { limitRequests, RateLimitError, withRequestLog } from '@/lib/request-guard';

const reply = (body: object) => NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
async function handlePOST(req: NextRequest) {
  try {
    const session = await requireRider(await getSession());
    const origin = req.headers.get('origin');
    let sameOrigin = !origin;
    try { if (origin) sameOrigin = ['http:', 'https:'].includes(new URL(origin).protocol) && new URL(origin).host === req.headers.get('host'); } catch {}
    if (!sameOrigin || req.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'This request is not allowed.' }, { status: 403 });
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
    if (!key || key.includes('your-google') || process.env.GOOGLE_MAPS_ENABLED !== '1') return reply({ provider: 'standard', reason: 'disabled' });
    const configured = Number(process.env.GOOGLE_MAPS_DAILY_LIMIT ?? '100');
    const dailyLimit = Number.isInteger(configured) && configured > 0 ? Math.min(100, configured) : 100;
    try {
      await limitRequests('rider:google-map-user', session.uid, 10, 60_000);
      // Shared atomic 24-hour budget window. Failed/abandoned loads count too.
      await limitRequests('rider:google-map-day-v1', 'all-riders', dailyLimit, 86_400_000);
    } catch (error) {
      if (error instanceof RateLimitError) return reply({ provider: 'standard', reason: 'limit' });
      throw error;
    }
    // Browser key: restrict to Rider's HTTPS referrer and Maps JavaScript API.
    return reply({ provider: 'google', key });
  } catch (error) { return riderErrorResponse(error); }
}
export const POST = withRequestLog('rider:map-session:POST', handlePOST);
