// Personal details and encoded tickets become available only after acceptance.
export function riderJobView<T extends { status: string }>(job: T) {
  if (!["PENDING", "MATCHED"].includes(job.status)) return job;
  return { ...job, customerId: undefined, customer: { name: "Customer", phone: null }, ticketId: undefined, ticket: null, cargoNotes: null };
}
