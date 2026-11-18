'use client';
import type { CancellationSummary } from '@/lib/rider-cancellation-policy';

export function CancellationNotice({ summary, compact = false }: { summary: CancellationSummary; compact?: boolean }) {
  if (compact && summary.level === 'none') return null;
  return <section className="rd-notice" role="status" aria-label="Daily cancellation status">
    <p className="font-semibold">{summary.pausedUntil ? 'New offers temporarily paused' : 'Today’s cancellations'}</p>
    <p>{summary.message}</p>
    <p className="text-sm">{summary.cancellations} avoidable / {summary.accepted} accepted · {summary.ratePercent}%</p>
    <p className="text-sm">Warnings reset at midnight, Philippine time. A running pause keeps its full duration.</p>
    {!compact && <><p className="text-sm">At least 4 avoidable cancellations and a rate of 20% or higher triggers a 15-minute pause. Safety, emergency and verified no-show cancellations are excluded.</p><a className="underline text-sm" href="mailto:fetchitsupport@gmail.com?subject=Cancellation%20review">Request a review</a></>}
  </section>;
}
