import { after } from "next/server";
import webpush from "web-push";
import { db } from "./db";
import { validPushEndpoint } from "./push-input";

// This private identity is shared only by server deployments through their
// existing database. Never return it from a subscription or notification API.
export async function webPushIdentity() {
  const existing = await db.webPushIdentity.findUnique({ where: { id: "customer" } });
  if (existing) return existing;
  const keys = webpush.generateVAPIDKeys();
  await db.$executeRaw`INSERT INTO "WebPushIdentity" ("id", "publicKey", "privateKey")
    VALUES ('customer', ${keys.publicKey}, ${keys.privateKey}) ON CONFLICT ("id") DO NOTHING`;
  return db.webPushIdentity.findUniqueOrThrow({ where: { id: "customer" } });
}

export async function deliverPendingNotifications() {
  // A short lease keeps simultaneous rider/admin requests from sending the
  // same event together. A crashed worker can be retried after its lease ends.
  const claimed = await db.$queryRaw<{ id: string }[]>`
    UPDATE "CustomerNotification" SET "pushLeaseUntil" = CURRENT_TIMESTAMP + INTERVAL '45 seconds', "pushAttempts" = "pushAttempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "CustomerNotification"
      WHERE "pushDeliveredAt" IS NULL AND "pushNextAttemptAt" <= CURRENT_TIMESTAMP
        AND ("pushLeaseUntil" IS NULL OR "pushLeaseUntil" < CURRENT_TIMESTAMP) AND "pushAttempts" < 5
      ORDER BY "createdAt" DESC LIMIT 12 FOR UPDATE SKIP LOCKED
    ) RETURNING "id"`;
  if (!claimed.length) return;
  const identity = await db.webPushIdentity.findUnique({ where: { id: "customer" } });
  await Promise.all(claimed.map(async ({ id }) => {
    const notification = await db.customerNotification.findUnique({ where: { id }, include: {
      customer: { select: { role: true, isBanned: true, authInvalidBefore: true } },
    } });
    if (!notification) return;
    const subscriptions = identity && notification.customer.role === "CUSTOMER" && !notification.customer.isBanned
      ? await db.customerPushSubscription.findMany({ where: { customerId: notification.customerId,
        createdAt: { lte: notification.createdAt },
        ...(notification.customer.authInvalidBefore ? { updatedAt: { gt: notification.customer.authInvalidBefore } } : {}),
      }, take: 10 }) : [];
    let failed = false;
    await Promise.all(subscriptions.map(async subscription => {
      if (!validPushEndpoint(subscription.endpoint)) return;
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({
          id, customerId: notification.customerId, category: notification.category, title: notification.title,
          // Support replies can contain sensitive information; keep it off the
          // lock screen. Full text is available only in the signed-in inbox.
          body: notification.category === "SUPPORT" ? "You have a new reply from Fetch-It support." : notification.body,
          url: notification.url,
        }), { vapidDetails: { subject: "https://fetch-it-v1-2.vercel.app", publicKey: identity!.publicKey, privateKey: identity!.privateKey },
          TTL: 3600, urgency: "high", timeout: 5000 });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.customerPushSubscription.deleteMany({ where: { id: subscription.id, endpoint: subscription.endpoint } });
        else failed = true;
      }
    }));
    await db.customerNotification.updateMany({ where: { id }, data: {
      pushLeaseUntil: null,
      ...(!failed || notification.pushAttempts >= 5 ? { pushDeliveredAt: new Date() } : {
        pushNextAttemptAt: new Date(Date.now() + Math.min(300_000, 5000 * 2 ** notification.pushAttempts)),
      }),
    } });
    if (failed) console.warn(JSON.stringify({ operation: "customer:web-push", code: "PUSH_DELIVERY_RETRY", exhausted: notification.pushAttempts >= 5 }));
  }));
}

export function schedulePushDelivery() {
  try {
    after(async () => {
      try { await deliverPendingNotifications(); }
      catch { console.warn(JSON.stringify({ operation: "customer:web-push", code: "PUSH_DELIVERY_UNAVAILABLE" })); }
    });
  } catch {
    // Direct CLI/integration calls have no HTTP lifecycle. They explicitly
    // exercise deliverPendingNotifications; real route handlers use after().
  }
}
