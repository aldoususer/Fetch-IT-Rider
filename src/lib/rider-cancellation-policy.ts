export const CANCELLATION_MINIMUM = 4;
export const CANCELLATION_RATE_PERCENT = 20;
export const CANCELLATION_PAUSE_MS = 15 * 60_000;
export const COUNTED_CANCELLATION_PREFIX = '[Counted rider cancellation] ';
export const EXEMPT_CANCELLATION_PREFIX = '[Exempt rider cancellation] ';
export const cancellationReasons = [
  { code: 'CHANGE_OF_PLANS', label: 'Change of plans', exempt: false },
  { code: 'OTHER', label: 'Other avoidable reason', exempt: false },
  { code: 'SAFETY', label: 'Safety concern', exempt: true },
  { code: 'EMERGENCY', label: 'Emergency / vehicle breakdown', exempt: true },
  { code: 'PASSENGER_NO_SHOW', label: 'Passenger no-show', exempt: true },
] as const;
export type CancellationCode = typeof cancellationReasons[number]['code'];
export type CancellationSummary = {
  day: string; resetsAt: string; accepted: number; cancellations: number; ratePercent: number;
  pausedUntil: string | null; level: 'none' | 'reminder' | 'warning' | 'final' | 'paused'; message: string;
};
export function cancellationDay(now = new Date()) {
  const local = new Date(now.getTime() + 8 * 3_600_000), day = local.toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00+08:00`), end = new Date(start.getTime() + 24 * 3_600_000);
  return { day, start, end };
}
export function cancellationQualifies(cancellations: number, accepted: number) {
  return cancellations >= CANCELLATION_MINIMUM && accepted > 0 && cancellations * 100 >= accepted * CANCELLATION_RATE_PERCENT;
}
export function offersPaused(presence: { offerPausedUntil?: Date | null } | null | undefined, now = new Date()) {
  return !!presence?.offerPausedUntil && presence.offerPausedUntil > now;
}
export function pauseMessage(until: Date | string) {
  return `New job offers paused until ${new Date(until).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} PH time after repeated cancellations.`;
}
export function cancellationSummary(accepted: number, cancellations: number, until: Date | null, now = new Date()): CancellationSummary {
  const { day, end } = cancellationDay(now), pausedUntil = until && until > now ? until.toISOString() : null;
  const ratePercent = accepted ? Math.round(cancellations / accepted * 1000) / 10 : 0;
  const level = pausedUntil ? 'paused' : cancellations >= 3 ? 'final' : cancellations === 2 ? 'warning' : cancellations === 1 ? 'reminder' : 'none';
  const message = pausedUntil ? pauseMessage(pausedUntil) : cancellations >= 4
    ? `${cancellations} avoidable cancellations from ${accepted} accepted bookings today (${ratePercent}%). Further avoidable cancellations can pause new offers when your rate is at least 20%.`
    : cancellations === 3 ? 'Final warning today: another avoidable cancellation will pause new offers for 15 minutes if your cancellation rate is at least 20%.'
    : cancellations === 2 ? 'Second avoidable cancellation today. Review a request before accepting it.'
    : cancellations === 1 ? 'First avoidable cancellation today. Please honour jobs you accept.'
    : 'No avoidable cancellations today.';
  return { day, resetsAt: end.toISOString(), accepted, cancellations, ratePercent, pausedUntil, level, message };
}
