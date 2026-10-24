export const APPLICATION_VEHICLES = ["MOTORCYCLE", "TRICYCLE", "SEDAN"] as const;
export const APPLICATION_SERVICES = ["DELIVERY", "RIDE"] as const;
export const SECTION_FIELDS = {
  personal: ["legalName", "birthDate", "address", "mobile"],
  emergency: ["emergencyName", "emergencyRelationship", "emergencyPhone"],
  licence: ["licenceNumber", "licenceCodes", "licenceExpiry", "nbiExpiry"],
  vehicle: ["vehicleMake", "vehicleModel", "vehicleYear", "plateNumber", "registrationExpiry", "capacity", "displacement"],
  ownership: ["ownership"],
  service: ["operatingArea", "permitNumber"],
} as const;
export const FIELD_LABELS: Record<string, string> = {
  legalName: "Legal name", birthDate: "Birth date", address: "Home address", mobile: "Mobile number",
  emergencyName: "Emergency contact name", emergencyRelationship: "Relationship", emergencyPhone: "Emergency phone",
  licenceNumber: "Professional licence number", licenceCodes: "Licence codes (A, A1 or B, comma separated)", licenceExpiry: "Licence valid until", nbiExpiry: "NBI clearance valid until",
  vehicleMake: "Vehicle make", vehicleModel: "Vehicle model", vehicleYear: "Model year", plateNumber: "Plate number", registrationExpiry: "Registration valid until",
  capacity: "Capacity (passengers for rides; kg for delivery only)", displacement: "Engine displacement (cc)", ownership: "Ownership",
  operatingArea: "Operating city / permitted zone", permitNumber: "Passenger permit / franchise reference",
};
export const DOCUMENT_LABELS: Record<string, string> = {
  PROFILE: "Profile photo", LICENCE_FRONT: "Professional licence — front", LICENCE_BACK: "Professional licence — back",
  NBI: "NBI clearance", OR: "Vehicle official receipt (OR)", CR: "Vehicle certificate of registration (CR)",
  OWNER_AUTH: "Owner authorization", OWNER_ID: "Owner valid ID", DEED_OF_SALE: "Notarized deed of sale",
  PASSENGER_PERMIT: "Passenger permit / franchise (LGU MTOP for tricycle; applicable TNVS authority for car)",
  PASSENGER_INSURANCE: "Passenger insurance", MEDICAL: "Medical certificate (if requested)", DRUG_TEST: "Drug-test result (if requested)",
};
export type Review = { status: "PENDING" | "ACCEPTED" | "NEEDS_CORRECTION" | "NOT_APPLICABLE"; reason?: string; reviewerId?: string };
export type Fields = Record<string, string>;
export class ApplicationError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function requiredDocuments(vehicle: string, services: string[], fields: Fields) {
  return ["PROFILE", "LICENCE_FRONT", "LICENCE_BACK", "NBI", "OR", "CR",
    ...(fields.ownership === "BORROWED" ? ["OWNER_AUTH", "OWNER_ID"] : []),
    ...(fields.ownership === "PURCHASED" ? ["DEED_OF_SALE"] : []),
    ...(services.includes("RIDE") && vehicle !== "MOTORCYCLE" ? ["PASSENGER_PERMIT", "PASSENGER_INSURANCE"] : []),
  ];
}
export function normalizeFields(input: unknown): Fields {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApplicationError("Enter valid application details.");
  const raw = input as Record<string, unknown>, fields: Fields = {};
  for (const key of Object.values(SECTION_FIELDS).flat()) {
    if (raw[key] !== undefined && (typeof raw[key] !== "string" || (raw[key] as string).length > (key === "address" ? 1000 : 200))) throw new ApplicationError(`Check ${FIELD_LABELS[key]}.`);
    fields[key] = String(raw[key] ?? "").trim();
  }
  return fields;
}
export function validateSelection(vehicle: unknown, services: unknown) {
  if (!(APPLICATION_VEHICLES as readonly unknown[]).includes(vehicle) || !Array.isArray(services) || !services.length || services.length > 2 || new Set(services).size !== services.length || services.some(s => !(APPLICATION_SERVICES as readonly unknown[]).includes(s))) throw new ApplicationError("Choose a supported vehicle and service.");
}
export function validateApplication(vehicle: string, services: string[], f: Fields, now = new Date()) {
  validateSelection(vehicle, services);
  const required = Object.values(SECTION_FIELDS).flat().filter(k => k !== "permitNumber" && k !== "displacement");
  for (const key of required) if (!f[key]) throw new ApplicationError(`Complete ${FIELD_LABELS[key]}.`);
  const dob = new Date(f.birthDate + "T00:00:00+08:00");
  const today = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10), eighteenth = new Date(dob); eighteenth.setUTCFullYear(eighteenth.getUTCFullYear() + 18);
  if (!Number.isFinite(dob.getTime()) || eighteenth > now || dob.getUTCFullYear() < 1900) throw new ApplicationError("Applicants must be at least 18. Check the birth date.");
  if (new Date(f.birthDate + "T00:00:00Z").toISOString().slice(0,10) !== f.birthDate) throw new ApplicationError("Check the birth date.");
  for (const key of ["licenceExpiry", "nbiExpiry", "registrationExpiry"]) if (!/^\d{4}-\d{2}-\d{2}$/.test(f[key]) || !Number.isFinite(Date.parse(f[key])) || new Date(f[key]).toISOString().slice(0,10) !== f[key] || f[key] < today) throw new ApplicationError(`${FIELD_LABELS[key]} must be valid.`);
  for (const key of ["mobile", "emergencyPhone"]) if (!/^(?:\+63|0)9\d{9}$/.test(f[key].replace(/[\s-]/g, ""))) throw new ApplicationError(`Enter a Philippine ${FIELD_LABELS[key].toLowerCase()}.`);
  if (!/^\d{4}$/.test(f.vehicleYear) || +f.vehicleYear < 1990 || +f.vehicleYear > now.getUTCFullYear() + 1) throw new ApplicationError("Check the vehicle model year.");
  if (!Number.isFinite(+f.capacity) || +f.capacity <= 0 || +f.capacity > 1000) throw new ApplicationError("Enter a valid capacity.");
  if (!["OWNER", "BORROWED", "PURCHASED"].includes(f.ownership)) throw new ApplicationError("Choose the vehicle ownership.");
  const code = vehicle === "MOTORCYCLE" ? "A" : vehicle === "TRICYCLE" ? "A1" : "B";
  if (!f.licenceCodes.toUpperCase().split(/[,\s]+/).includes(code)) throw new ApplicationError(`Declare the appropriate ${code} licence code for this vehicle; staff will verify it.`);
  if (vehicle !== "SEDAN" && (!Number.isFinite(+f.displacement) || +f.displacement <= 0)) throw new ApplicationError("Enter the engine displacement.");
  if (services.includes("RIDE") && vehicle !== "MOTORCYCLE" && !f.permitNumber) throw new ApplicationError("Enter your applicable passenger permit / franchise reference.");
}
export function approvalExpiry(fields: Fields) {
  return new Date([fields.licenceExpiry, fields.nbiExpiry, fields.registrationExpiry].sort()[0] + "T23:59:59+08:00");
}
