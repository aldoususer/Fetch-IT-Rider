// Development lab only. A flag alone can never enable this against public data.
import { db } from './db';
export function localDemoEnabled(env = process.env) {
  if (env.NODE_ENV === 'production' || env.VERCEL || env.LOCAL_RIDER_LAB !== '1' || !/^fetch_rider_lab_[a-f0-9]{32}$/.test(env.LOCAL_DEMO_SCHEMA || '')) return false;
  try {
    const url = new URL(env.DATABASE_URL || '');
    return url.searchParams.get('schema') === env.LOCAL_DEMO_SCHEMA && url.searchParams.get('options') === `-c search_path=${env.LOCAL_DEMO_SCHEMA},pg_catalog`;
  } catch { return false; }
}
export async function assertLocalDemo(request?: Request) {
  if (!localDemoEnabled()) throw new Error('Local demo lab unavailable.');
  if (request) {
    const url = new URL(request.url);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('Local demo lab unavailable.');
    // Next dev normalizes request.url to localhost even when the browser uses 127.0.0.1.
    const browserUrl = new URL(`http://${request.headers.get('host') || url.host}`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(browserUrl.hostname) || browserUrl.port !== url.port) throw new Error('Local demo lab unavailable.');
    if (request.method !== 'GET' && (request.headers.get('origin') !== browserUrl.origin || request.headers.get('sec-fetch-site') === 'cross-site')) throw new Error('Local demo requests must come from this app.');
  }
  const [row] = await db.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`;
  if (row?.schema !== process.env.LOCAL_DEMO_SCHEMA) throw new Error('Local database isolation check failed.');
}
