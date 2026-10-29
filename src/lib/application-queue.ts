export const APPLICATION_STATUS_FILTERS = [
  { value: 'PENDING_VERIFICATION', label: 'Pending verification', statuses: ['SUBMITTED', 'IN_REVIEW'] },
  { value: 'NEEDS_CORRECTION', label: 'Needs correction', statuses: ['NEEDS_CORRECTION'] },
  { value: 'ORIENTATION', label: 'For orientation', statuses: ['RECOMMENDED', 'ORIENTATION_SCHEDULED'] },
  { value: 'AWAITING_ACTIVATION', label: 'Awaiting service activation', statuses: ['ASSESSED', 'DEMO_COMPLETED'] },
  { value: 'ACTIVE', label: 'Active', statuses: ['ACTIVE'] },
  { value: 'REJECTED', label: 'Rejected', statuses: ['REJECTED'] },
  { value: 'PENDING_APPROVAL', label: 'Pending admin approval', statuses: ['FORCE_APPROVAL_PENDING'] },
] as const;

const legacyStatuses = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'NEEDS_CORRECTION', 'RECOMMENDED', 'ORIENTATION_SCHEDULED', 'ASSESSED', 'ACTIVE', 'DEMO_COMPLETED', 'REJECTED', 'FORCE_APPROVAL_PENDING'];

// Keep existing direct API links working while the UI uses fewer, meaningful queues.
export function applicationQueueStatuses(value:string|null):string[]|undefined {
  if(!value)return undefined;
  const queue=APPLICATION_STATUS_FILTERS.find(option=>option.value===value);
  if(queue)return [...queue.statuses];
  return legacyStatuses.includes(value)?[value]:undefined;
}

export function normalizeApplicationFilter(value:string) {
  return APPLICATION_STATUS_FILTERS.find(option=>option.value===value||(option.statuses as readonly string[]).includes(value))?.value??'';
}
