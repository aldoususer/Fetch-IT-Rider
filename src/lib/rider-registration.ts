import { SECTION_FIELDS, FIELD_LABELS, DOCUMENT_LABELS, requiredDocuments, validateApplication, validateSelection, type Fields, type Review } from './rider-application-policy';

export const REGISTRATION_STEPS = ['Account', 'Vehicle & services', 'Details', 'Documents', 'Review'] as const;
export const STEP_KEYS = ['account', 'vehicle', 'details', 'documents', 'review'] as const;
export type RegistrationStep = 0 | 1 | 2 | 3 | 4;
export type RegistrationDocument = { id: string; kind: string; current: boolean; status: string; reason?: string };
type ProgressApplication = { status: string; emailVerifiedAt?: string; vehicleClass: string; services: string[]; fields: Fields; fieldReviews: Record<string, Review>; documents: RegistrationDocument[] };
export function visibleFields(keys: readonly string[], vehicle: string, services: string[]) {
  return keys.filter(key => !(key === 'displacement' && vehicle === 'SEDAN') && !(key === 'permitNumber' && (!services.includes('RIDE') || vehicle === 'MOTORCYCLE')));
}
export function resumeRegistration(app: ProgressApplication): RegistrationStep {
  if (!['DRAFT', 'NEEDS_CORRECTION'].includes(app.status)) return 4;
  if (!app.emailVerifiedAt) return 0;
  if (app.status === 'NEEDS_CORRECTION') {
    if (Object.values(app.fieldReviews).some(r => r.status === 'NEEDS_CORRECTION')) return 2;
    if (app.documents.some(d => d.current && d.status === 'NEEDS_CORRECTION')) return 3;
  }
  const saved = STEP_KEYS.indexOf(app.fields.registrationStep as typeof STEP_KEYS[number]);
  if (saved > 0) return saved as RegistrationStep;
  return Object.values(SECTION_FIELDS).flat().some(key => !['legalName', 'mobile', 'plateNumber'].includes(key) && app.fields[key]) ? 2 : 1;
}
export type RegistrationIssue = { step: RegistrationStep; message: string };
export function registrationIssues(app: ProgressApplication, vehicle: string, services: string[], fields: Fields, now = new Date()): RegistrationIssue[] {
  const issues: RegistrationIssue[] = [];
  if (!app.emailVerifiedAt) issues.push({ step: 0, message: 'Verify your email.' });
  try { validateSelection(vehicle, services); } catch { issues.push({ step: 1, message: 'Choose your vehicle and at least one service.' }); }
  const missing = Object.values(SECTION_FIELDS).flat().filter(key => visibleFields([key], vehicle, services).length && !fields[key]?.trim());
  for (const key of missing) issues.push({ step: 2, message: `Complete ${FIELD_LABELS[key]}.` });
  if (!missing.length) {
    try { validateApplication(vehicle, services, fields, now); } catch (error) { issues.push({ step: 2, message: error instanceof Error ? error.message : 'Check your details.' }); }
  }
  for (const [section, review] of Object.entries(app.fieldReviews)) if (review.status === 'NEEDS_CORRECTION' && !SECTION_FIELDS[section as keyof typeof SECTION_FIELDS]?.some(key => fields[key] !== (app.fields[key] ?? ''))) issues.push({ step: 2, message: `Correct the ${section} details${review.reason ? ': ' + review.reason : '.'}` });
  for (const kind of requiredDocuments(vehicle, services, fields)) {
    const doc = app.documents.find(d => d.current && d.kind === kind);
    if (!doc || doc.status === 'NEEDS_CORRECTION') issues.push({ step: 3, message: `${doc ? 'Replace' : 'Upload'} ${DOCUMENT_LABELS[kind]}.` });
  }
  for (const doc of app.documents) if (doc.current && doc.status === 'NEEDS_CORRECTION' && !requiredDocuments(vehicle, services, fields).includes(doc.kind)) issues.push({ step: 3, message: `Replace ${DOCUMENT_LABELS[doc.kind] || doc.kind}.` });
  return issues;
}
