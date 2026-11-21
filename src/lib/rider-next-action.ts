type ActionContext = {
  type: string; status: string; pickupCode: string; paymentReady: boolean; proofOpen: boolean;
  customerPickupConfirmedAt?: unknown; customerDropoffConfirmedAt?: unknown;
};
export function riderNextAction(job: ActionContext) {
  const ride = job.type === 'RIDE';
  if (ride && job.status === 'ACCEPTED' && !/^\d{6}$/.test(job.pickupCode))
    return { kind: 'pickup' as const, label: 'Enter pickup code', hint: 'Verify the passenger’s code at pickup.' };
  if (ride && ['PICKED_UP', 'IN_TRANSIT'].includes(job.status) && !job.customerPickupConfirmedAt)
    return { kind: 'confirmation' as const, label: 'Review customer confirmations', hint: 'Customer pickup confirmation is missing.' };
  if (job.status === 'IN_TRANSIT') {
    if (ride && !job.customerDropoffConfirmedAt)
      return { kind: 'confirmation' as const, label: 'Review customer confirmations', hint: 'Customer must confirm arrival at drop-off.' };
    if (!job.paymentReady)
      return { kind: 'payment' as const, label: 'Review payment', hint: 'Payment confirmation is required before completion.' };
    if (!ride) return { kind: job.proofOpen ? 'submit-proof' as const : 'proof' as const, label: job.proofOpen ? 'Complete delivery' : 'Capture signature & photo', hint: '' };
  }
  return { kind: 'advance' as const, label: '', hint: '' };
}
