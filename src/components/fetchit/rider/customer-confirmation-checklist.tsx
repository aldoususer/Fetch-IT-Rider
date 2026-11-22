import type { RiderJob } from '@/lib/rider-workspace';

export function CustomerConfirmationChecklist({ job, label, hint }: { job: RiderJob; label: string; hint: string }) {
  return <section className="rd-confirmations" aria-label="Next action">
    <div role="status">
      <h3>{label}</h3>
      <p>{hint}</p>
    </div>
    <div className="rd-confirmation-links">
      {job.customer?.phone && <a href={`tel:${job.customer.phone}`}>Call passenger</a>}
      <a href={`mailto:fetchitsupport@gmail.com?subject=${encodeURIComponent(`Ride confirmation help · ${job.refCode}`)}`}>Get help</a>
    </div>
  </section>;
}
