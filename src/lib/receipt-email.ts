import { after } from "next/server";
import nodemailer from "nodemailer";
import type { PrismaClient } from "@prisma/client";
import { buildBookingReceipt } from "./booking-receipt";
import { isDemoPayment } from "./payment-policy";

// The paid booking is the durable outbox. A lease prevents simultaneous
// confirmations and retries from emailing the same receipt concurrently.
export async function deliverReceiptEmails(db: PrismaClient) {
  const sender = process.env.GMAIL_SENDER?.trim();
  const password = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
  if (!sender || !password) {
    console.warn("[receipt-email] Email sender is not configured; receipts remain queued.");
    return { sent: 0, configured: false };
  }
  const claimed = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Booking" SET "receiptEmailLeaseUntil" = CURRENT_TIMESTAMP + INTERVAL '2 minutes',
      "receiptEmailAttempts" = "receiptEmailAttempts" + 1
    WHERE "id" IN (SELECT "id" FROM "Booking"
      WHERE "paymentStatus" = 'PAID' AND "receiptEmailedAt" IS NULL AND "receiptEmailQueuedAt" IS NOT NULL
        AND "receiptEmailNextAttemptAt" <= CURRENT_TIMESTAMP
        AND ("receiptEmailLeaseUntil" IS NULL OR "receiptEmailLeaseUntil" < CURRENT_TIMESTAMP)
      ORDER BY "paidAt" DESC LIMIT 5 FOR UPDATE SKIP LOCKED)
    RETURNING "id"`;
  const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: sender, pass: password }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000 });
  let sent = 0;
  try {
    for (const { id } of claimed) {
      try {
        const booking = await db.booking.findUniqueOrThrow({ where: { id }, include: {
          customer: { select: { name: true, email: true } }, rider: { select: { name: true } },
        } });
        if (booking.paymentStatus !== "PAID") {
          await db.booking.update({ where: { id }, data: { receiptEmailLeaseUntil: null } });
          continue;
        }
        const pdf = await buildBookingReceipt(booking, booking.paidAt ?? new Date());
        const simulated = isDemoPayment(booking.paymentMethod);
        const result = await transport.sendMail({ from: { name: "Fetch-It", address: sender }, to: booking.customer.email,
          messageId: `<receipt-${id}@${sender.split("@")[1]}>`,
          subject: `${simulated ? "Test booking receipt" : "Payment receipt"} - ${booking.refCode}`,
          text: `Hello ${booking.customer.name},\n\n${simulated ? "Your test payment was recorded. No money was charged." : "Your payment is confirmed."} Your Fetch-It receipt is attached.\n\nBooking: ${booking.refCode}\nAmount: ${booking.currency} ${Number(booking.totalFare).toFixed(2)}\n\nThank you for choosing Fetch-It.`,
          attachments: [{ filename: `fetchit-${booking.refCode.replace(/[^a-zA-Z0-9-]/g, "")}.pdf`, content: Buffer.from(pdf), contentType: "application/pdf" }],
        });
        if (!result.accepted?.length) throw new Error("Email was not accepted.");
        await db.booking.update({ where: { id }, data: { receiptEmailedAt: new Date(), receiptEmailLeaseUntil: null } });
        sent++;
      } catch {
        await db.booking.update({ where: { id }, data: { receiptEmailLeaseUntil: null,
          receiptEmailNextAttemptAt: new Date(Date.now() + 5 * 60_000) } });
        console.warn("[receipt-email] Delivery failed; receipt queued for retry.");
      }
    }
  } finally { transport.close(); }
  return { sent, configured: true };
}

export function scheduleReceiptDelivery(db: PrismaClient) {
  try { after(async () => {
    try { await deliverReceiptEmails(db); }
    catch { console.warn("[receipt-email] Delivery unavailable; receipts remain queued."); }
  }); } catch { /* CLI callers can explicitly drain the outbox. */ }
}
