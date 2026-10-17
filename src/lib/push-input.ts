const pushHosts = ["fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com", "push.services.mozilla.com"];

export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash && url.pathname !== "/" &&
      (pushHosts.includes(url.hostname) || url.hostname.endsWith(".push.services.mozilla.com") || url.hostname.endsWith(".notify.windows.com"));
  } catch { return false; }
}

export function parsePushSubscription(body: unknown) {
  const input = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!input || !validPushEndpoint(input.endpoint) || typeof input.keys?.p256dh !== "string" || typeof input.keys?.auth !== "string") return null;
  const { p256dh, auth } = input.keys;
  if (!/^[A-Za-z0-9_-]{87}={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}={0,2}$/.test(auth)) return null;
  const key = Buffer.from(p256dh, "base64url");
  if (key.length !== 65 || key[0] !== 4 || Buffer.from(auth, "base64url").length !== 16) return null;
  return { endpoint: input.endpoint, p256dh, auth };
}
