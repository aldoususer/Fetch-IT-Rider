import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Booking } from "@prisma/client";
import { VEHICLES } from "./pricing-defaults";
import { statusLabel as customerStatusLabel } from "./pricing-defaults";
import { isDemoPayment, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from "./payment-policy";

type ReceiptBooking = Pick<Booking,
  "refCode" | "type" | "status" | "createdAt" | "deliveredAt" | "scheduledAt" |
  "pickupLabel" | "dropoffLabel" | "vehicleClass" | "distanceKm" | "passengers" |
  "cargoWeightKg" | "baseFare" | "totalFare" | "currency" | "surgeMultiplier" |
  "paymentMethod" | "paymentStatus" | "paidAt" | "paymentReference" | "cancellationReason"
> & { customer: { name: string }; rider: { name: string } | null };

const WIDTH = 360;
const MARGIN = 28;
const INK = rgb(0.09, 0.18, 0.16);
const MUTED = rgb(0.39, 0.45, 0.43);
const GREEN = rgb(0.08, 0.32, 0.25);
const LINE = rgb(0.80, 0.84, 0.82);
const PALE = rgb(0.93, 0.97, 0.95);

function dateLabel(value: Date) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(value) + " (PH)";
}

// Standard PDF fonts support Latin names and punctuation. Unsupported characters
// get a visible replacement rather than making the entire download fail.
function printable(value: string, font: PDFFont) {
  return Array.from(value.replace(/\s+/g, " ").trim()).map(char => {
    try { font.encodeText(char); return char; } catch { return "?"; }
  }).join("");
}

function wrap(value: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of printable(value, font).split(" ")) {
    const candidate = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
    if (line) { lines.push(line); line = ""; }
    // Split long reference numbers and unbroken addresses, too.
    for (const char of word) {
      if (line && font.widthOfTextAtSize(line + char, size) > width) {
        lines.push(line); line = "";
      }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["-"];
}

export async function buildBookingReceipt(booking: ReceiptBooking, issuedAt = new Date()) {
  if (booking.paymentStatus !== "PAID") throw new Error("Receipts are available after payment is confirmed.");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const draws: ((page: PDFPage, height: number) => void)[] = [];
  let y = 28;
  const contentWidth = WIDTH - MARGIN * 2;
  const money = (amount: number) => booking.currency + " " + amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const drawText = (value: string, x: number, top: number, size = 9, font = regular, color = INK) => {
    const text = printable(value, font);
    draws.push((page, height) => page.drawText(text, { x, y: height - top - size, size, font, color }));
  };
  const centered = (value: string, top: number, size: number, font = regular, color = INK) => {
    const text = printable(value, font);
    drawText(text, (WIDTH - font.widthOfTextAtSize(text, size)) / 2, top, size, font, color);
  };
  const rule = () => {
    const top = y;
    draws.push((page, height) => page.drawLine({
      start: { x: MARGIN, y: height - top }, end: { x: WIDTH - MARGIN, y: height - top },
      thickness: 0.6, color: LINE, dashArray: [2, 3],
    }));
    y += 18;
  };
  const section = (title: string) => { drawText(title, MARGIN, y, 8, bold, GREEN); y += 22; };
  const row = (label: string, value: string, font = regular) => {
    drawText(label, MARGIN, y, 9, regular, MUTED);
    const lines = wrap(value, font, 9, contentWidth - 108);
    for (const line of lines) { drawText(line, MARGIN + 108, y, 9, font); y += 13; }
    y += 6;
  };
  const address = (label: string, value: string, letter: string) => {
    const top = y;
    draws.push((page, height) => page.drawCircle({
      x: MARGIN + 9, y: height - top - 10, size: 9, color: PALE,
    }));
    drawText(letter, MARGIN + 6, top + 5, 8, bold, GREEN);
    drawText(label, MARGIN + 28, y, 8, regular, MUTED);
    y += 15;
    for (const line of wrap(value, regular, 10, contentWidth - 28)) {
      drawText(line, MARGIN + 28, y, 10); y += 14;
    }
    y += 16;
  };

  centered("FETCH-IT", y, 27, bold, GREEN); y += 36;
  centered("RIDES & DELIVERIES", y, 8, regular, MUTED); y += 28;
  centered("BOOKING RECEIPT", y, 11, bold); y += 26;
  rule();
  row("Receipt no.", booking.refCode, mono);
  row("Issued", dateLabel(issuedAt));
  row("Booked", dateLabel(booking.createdAt));
  row("Booking status", booking.type === "RIDE" && booking.status === "DELIVERED" ? "Arrived" : customerStatusLabel(booking.status, booking.type), bold);
  if (booking.scheduledAt) row("Scheduled pickup", dateLabel(booking.scheduledAt));
  if (booking.deliveredAt) row("Completed", dateLabel(booking.deliveredAt));
  y += 4; rule();

  section("CUSTOMER & SERVICE");
  row("Customer", booking.customer.name, bold);
  row(booking.type === "RIDE" ? "Driver" : "Rider", booking.rider?.name || "Not yet assigned");
  row("Service", booking.type === "RIDE" ? "Passenger ride" : "Delivery");
  row("Vehicle", VEHICLES[booking.vehicleClass]?.label || booking.vehicleClass.replaceAll("_", " "));
  row("Distance", booking.distanceKm.toLocaleString("en-PH", { maximumFractionDigits: 2 }) + " km");
  row(booking.type === "RIDE" ? "Passengers" : "Cargo weight", booking.type === "RIDE" ? String(booking.passengers) : booking.cargoWeightKg + " kg");
  y += 4; rule();

  section("JOURNEY");
  address("PICKUP", booking.pickupLabel, "A");
  address("DROP-OFF", booking.dropoffLabel, "B");
  rule();

  section("FARE DETAILS");
  const total = Number(booking.totalFare);
  const base = Number(booking.baseFare);
  // Use historical stored amounts; never recalculate an old receipt at today's rates.
  if (base >= 0 && base <= total) {
    row("Base fare", money(base));
    const adjustment = Math.round((total - base) * 100) / 100;
    if (adjustment > 0) row("Distance & adjustments", money(adjustment));
  } else {
    row("Service fare", money(total));
  }
  if (Number(booking.surgeMultiplier) > 1) {
    drawText("Includes " + Number(booking.surgeMultiplier) + "x demand pricing", MARGIN, y, 8, regular, MUTED);
    y += 20;
  }

  y += 4;
  const totalTop = y;
  draws.push((page, height) => page.drawRectangle({
    x: MARGIN, y: height - totalTop - 62, width: contentWidth, height: 62, color: PALE,
  }));
  drawText("TOTAL FARE", MARGIN + 14, y + 10, 8, bold, GREEN);
  const totalText = money(total);
  const totalSize = Math.min(24, (contentWidth - 28) / bold.widthOfTextAtSize(totalText, 1));
  drawText(totalText, MARGIN + 14, y + 25, totalSize, bold, GREEN);
  y += 82;
  rule();

  section("PAYMENT");
  row("Method", PAYMENT_METHOD_LABEL[booking.paymentMethod]);
  const simulated = isDemoPayment(booking.paymentMethod);
  // A checkout record is not evidence that money moved. Keep the settlement
  // factual without printing internal environment or payment-method names.
  const paymentStatus = simulated ? "No funds collected" : PAYMENT_STATUS_LABEL[booking.paymentStatus];
  row("Status", paymentStatus, bold);
  if (booking.paidAt) row(simulated ? "Recorded on" : "Paid on", dateLabel(booking.paidAt));
  if (booking.paymentReference) row("Reference", booking.paymentReference, mono);
  if (booking.cancellationReason) { y += 8; section("CANCELLATION"); row("Reason", booking.cancellationReason); }
  y += 6; rule();
  centered("Thank you for choosing Fetch-It.", y, 10, bold, GREEN); y += 20;
  centered("Keep this receipt for your booking records.", y, 8, regular, MUTED); y += 16;
  centered("Need help? Open this booking in the Fetch-It app.", y, 7.5, regular, MUTED);
  y += 32;

  const height = y;
  const page = pdf.addPage([WIDTH, height]);
  page.drawRectangle({ x: 0, y: height - 5, width: WIDTH, height: 5, color: GREEN });
  for (const draw of draws) draw(page, height);
  pdf.setTitle("Fetch-It booking receipt - " + booking.refCode);
  pdf.setAuthor("Fetch-It");
  pdf.setSubject(booking.type === "RIDE" ? "Ride booking receipt" : "Delivery booking receipt");
  pdf.setCreationDate(issuedAt);
  return pdf.save();
}
