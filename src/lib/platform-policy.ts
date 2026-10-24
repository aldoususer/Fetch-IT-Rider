import { VEHICLES, BOOKING_VEHICLE_CLASSES, type VehicleClass } from "./pricing-defaults";
export type PlatformSettings = {
  rideEnabled: boolean; deliveryEnabled: boolean; vehicles: VehicleClass[];
  commissionPercent: number; offerSeconds: number; maxReassignments: number;
  maxSurge: number; morningSurge: number; eveningSurge: number; nightSurge: number; fridayExtra: number;
  fares: Record<string, { baseFare: number; minimumFare: number; includedKm: number; perKm: number; longHaulPerKm: number; freeWeightKg: number; perKgOverFree: number }>;
};
export function defaultPlatformSettings(): PlatformSettings {
  const commissionPercent = Number(process.env.DEMO_COMMISSION_PERCENT ?? 15);
  return { rideEnabled: true, deliveryEnabled: true, vehicles: [...BOOKING_VEHICLE_CLASSES],
    commissionPercent: Number.isFinite(commissionPercent) && commissionPercent >= 0 && commissionPercent <= 100 ? commissionPercent : 15,
    offerSeconds: 120, maxReassignments: 5, maxSurge: 1.5, morningSurge: 1.25, eveningSurge: 1.35, nightSurge: 1.15, fridayExtra: .15,
    fares: Object.fromEntries(BOOKING_VEHICLE_CLASSES.map(id => { const v = VEHICLES[id]; return [id, { baseFare: v.baseFare, minimumFare: v.minimumFare, includedKm: v.includedKm, perKm: v.perKm, longHaulPerKm: v.longHaulPerKm, freeWeightKg: v.freeWeightKg, perKgOverFree: v.perKgOverFree }]; })) };
}
export function validatePlatformSettings(value: unknown): PlatformSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose valid platform settings.");
  const input = value as Record<string, unknown>;
  const defaults = defaultPlatformSettings();
  if (Object.keys(input).some(key => !(key in defaults))) throw new Error("Unknown setting.");
  if (typeof input.rideEnabled !== "boolean" || typeof input.deliveryEnabled !== "boolean") throw new Error("Choose service availability.");
  if (!Array.isArray(input.vehicles) || !input.vehicles.length || input.vehicles.some(v => !BOOKING_VEHICLE_CLASSES.includes(v)) || new Set(input.vehicles).size !== input.vehicles.length) throw new Error("Choose at least one supported vehicle.");
  for (const [key, min, max] of [["commissionPercent",0,100],["offerSeconds",30,600],["maxReassignments",0,20],["maxSurge",1,2],["morningSurge",1,2],["eveningSurge",1,2],["nightSurge",1,2],["fridayExtra",0,.5]] as const) {
    const n=input[key]; if(typeof n!=="number" || !Number.isFinite(n) || n<min || n>max || Math.round(n*100)!==n*100 && Math.abs(Math.round(n*100)-n*100)>.00001) throw new Error(`Invalid ${key}.`);
  }
  if (!Number.isInteger(input.offerSeconds) || !Number.isInteger(input.maxReassignments)) throw new Error("Dispatch limits must be whole numbers.");
  const fares=input.fares as PlatformSettings["fares"];
  for(const id of BOOKING_VEHICLE_CLASSES) {
    if(!fares?.[id]) throw new Error(`Missing ${id} fares.`);
    for(const key of Object.keys(defaults.fares[id])) {
      const n=fares[id][key as keyof typeof fares[string]];
      if(typeof n!=="number" || !Number.isFinite(n) || n<0 || n>100000 || Math.abs(Math.round(n*100)-n*100)>.00001) throw new Error(`Invalid ${id} ${key}.`);
    }
  }
  return { ...defaults, ...input, fares: Object.fromEntries(BOOKING_VEHICLE_CLASSES.map(id => [id, Object.fromEntries(Object.keys(defaults.fares[id]).map(key=>[key,fares[id][key as keyof typeof fares[string]]]))])) } as PlatformSettings;
}
export function configuredSurge(settings: PlatformSettings, date = new Date()) {
  const local = new Date(date.getTime() + 8*60*60_000); const h=local.getUTCHours(),day=local.getUTCDay();
  let m=h>=7&&h<=9?settings.morningSurge:h>=17&&h<=20?settings.eveningSurge:h>=22||h<=5?settings.nightSurge:1;
  if(day===5 && h>=17 && h<=20) m+=settings.fridayExtra;
  if(day===0 && h>=8 && h<=16) m-=.1;
  return Math.round(Math.min(settings.maxSurge,Math.max(1,m))*100)/100;
}
