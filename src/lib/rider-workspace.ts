import type { BookingStatus, VehicleClass } from './constants';

export interface RiderJob {
  id: string; refCode: string; ticketId: string | null; ticket: string | null; type: string;
  customerId: string; riderId: string | null; pickupLabel: string; pickupLat: number; pickupLng: number;
  dropoffLabel: string; dropoffLat: number; dropoffLng: number; vehicleClass: VehicleClass;
  cargoWeightKg: number; passengers: number; cargoNotes: string | null; scheduledAt: string | null;
  distanceKm: number; baseFare: number; surgeMultiplier: number; totalFare: number; paymentMethod: string;
  paymentStatus: string; demoCommissionBps: number | null; demoRiderEarnings: number | null; currency: string;
  status: BookingStatus; assignmentExpiresAt?: string | null; etaMinutes: number | null; createdAt: string; updatedAt?: string;
  customer: { id: string; name: string; phone: string | null };
}

export function mergeRiderJob<T extends {updatedAt?: string; status?: string}>(current: T, incoming: T) {
  if (['DELIVERED', 'CANCELLED'].includes(current.status ?? '') && !['DELIVERED', 'CANCELLED'].includes(incoming.status ?? '')) return current;
  return Date.parse(current.updatedAt ?? '') > Date.parse(incoming.updatedAt ?? '') ? current : incoming;
}

export const isHistoryJob = (job: Pick<RiderJob, 'status'>) => ['DELIVERED', 'CANCELLED'].includes(job.status);
export const isUpcomingJob = (job: Pick<RiderJob, 'scheduledAt'>, now = Date.now()) => !!job.scheduledAt && Date.parse(job.scheduledAt) > now;
export function formatJobTime(value: string) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'Time unavailable';
}
export function nextJobStop(job: Pick<RiderJob, 'status' | 'pickupLabel' | 'dropoffLabel'>) {
  const pickup = ['PENDING', 'MATCHED', 'ACCEPTED'].includes(job.status);
  return { label: pickup ? 'Pickup' : 'Drop-off', address: pickup ? job.pickupLabel : job.dropoffLabel, navigation: pickup ? 'pickup' as const : 'dropoff' as const };
}
export function jobTiming(job: Pick<RiderJob, 'scheduledAt' | 'createdAt'>, now = Date.now()) {
  if (isUpcomingJob(job, now)) return { kind: 'upcoming', label: `Pickup ${formatJobTime(job.scheduledAt!)} · PH time` };
  if (job.scheduledAt && now - Date.parse(job.scheduledAt) > 15 * 60_000) return { kind: 'overdue', label: `Pickup time passed · ${formatJobTime(job.scheduledAt)} PH time` };
  const hours = Math.floor((now - Date.parse(job.createdAt)) / 3_600_000);
  if (hours >= 2) return { kind: 'older', label: `Older request · ${hours >= 24 ? `${Math.floor(hours / 24)} days` : `${hours} hours`} ago` };
  return { kind: 'now', label: job.scheduledAt ? `Pickup ${formatJobTime(job.scheduledAt)} · PH time` : 'Pickup now' };
}
export function filterHistoryJobs<T extends Pick<RiderJob, 'refCode' | 'pickupLabel' | 'dropoffLabel' | 'status'>>(jobs: T[], query: string, status: string) {
  const text = query.trim().toLocaleLowerCase();
  return jobs.filter(job => (status === 'ALL' || job.status === status) && (!text || `${job.refCode} ${job.pickupLabel} ${job.dropoffLabel}`.toLocaleLowerCase().includes(text)));
}
export function availabilityLabel(online: boolean | null, pending = false) {
  return online === null ? 'Checking availability…' : pending ? 'Updating…' : online ? 'Online' : 'Offline';
}
export function pickupCodeFeedback(message: string) {
  if (/pickup code did not match/i.test(message)) return 'That code doesn’t match. Check the six digits with the passenger and try again.';
  if (/reveal a new pickup code/i.test(message)) return 'This pickup code is unavailable or expired. Ask the passenger to refresh their pickup code.';
  return message;
}
