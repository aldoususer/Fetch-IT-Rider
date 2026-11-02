// Planning speeds match the vehicle defaults, not free-flow road speeds.
// This is an initial conservative policy, not a traffic model or calibrated SLA.
const speeds: Record<string, number> = { MOTORCYCLE: 22, TRICYCLE: 18, SEDAN: 20, CLOSED_VAN: 18, FLATBED: 16, REFRIGERATED: 18 };
export function planningTravelSeconds(distanceMeters: number, providerSeconds: number, vehicle: string, configuredSpeed?: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0 || !Number.isFinite(providerSeconds) || providerSeconds < 0) throw new RangeError('Invalid travel estimate');
  const speed = configuredSpeed !== undefined && Number.isFinite(configuredSpeed) && configuredSpeed > 0 ? configuredSpeed : speeds[vehicle] ?? 18;
  const localTravel = distanceMeters / 1000 / speed * 3600;
  const stopAllowance = distanceMeters > 0 || providerSeconds > 0 ? 60 : 0;
  return Math.ceil(Math.max(providerSeconds, localTravel) + stopAllowance);
}

// An allowance band, not a statistical confidence interval. Round upwards to
// avoid presenting a fraction of a minute as an exact arrival promise.
export function travelTimeRange(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid travel estimate');
  const low = Math.max(1, Math.ceil(seconds / 60));
  const high = low + Math.max(2, Math.ceil(low * .25));
  return `${low}–${high}`;
}
