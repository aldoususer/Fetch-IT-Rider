'use client';

import { useRef, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export type RiderHistoryFilters = { status: string; date: string; basis: 'created' | 'finished' };
export const EMPTY_HISTORY_FILTERS: RiderHistoryFilters = { status: 'ALL', date: '', basis: 'created' };

export function HistoryFilters({ query, filters, onQuery, onApply }: {
  query: string;
  filters: RiderHistoryFilters;
  onQuery: (value: string) => void;
  onApply: (value: RiderHistoryFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ status: filters.status, basis: filters.basis });
  const title = useRef<HTMLHeadingElement>(null);
  const dateField = useRef<HTMLInputElement>(null);
  const { date, status, basis } = filters;
  const count = Number(status !== 'ALL') + Number(!!date);
  const labels = [
    status === 'DELIVERED' ? 'Completed' : status === 'CANCELLED' ? 'Cancelled' : '',
    date ? `${basis === 'finished' ? 'Finished' : 'Booked'} ${new Date(`${date}T00:00:00+08:00`).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' })} (PH time)` : '',
  ].filter(Boolean);

  return <div className="rd-history-tools">
    <div className="rd-search"><Search size={18} aria-hidden="true"/><label className="sr-only" htmlFor="rider-history-search">Search booking history</label><input id="rider-history-search" type="search" placeholder="Search reference or address" value={query} onChange={event => onQuery(event.target.value)}/></div>
    <Dialog open={open} onOpenChange={value => {
      if (value) {
        setDraft({ status, basis });
        if (dateField.current) dateField.current.value = date;
      }
      setOpen(value);
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="min-h-12"><SlidersHorizontal size={18} aria-hidden="true"/>Filters{count ? ` · ${count}` : ''}</Button>
      </DialogTrigger>
      <DialogContent fullScreenOnMobile className="rd-filter-sheet" onOpenAutoFocus={event => {
        event.preventDefault();
        title.current?.focus();
      }}>
        <DialogHeader>
          <DialogTitle ref={title} tabIndex={-1}>Filter booking history</DialogTitle>
          <DialogDescription>Choose a booking status or date.</DialogDescription>
        </DialogHeader>
        <form onSubmit={event => {
          event.preventDefault();
          onApply({ ...draft, date: dateField.current?.value ?? '' });
          setOpen(false);
        }}>
          <div className="rd-history-fields">
            <label>Status<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="ALL">All bookings</option><option value="DELIVERED">Completed</option><option value="CANCELLED">Cancelled</option></select></label>
            <label>Date based on<select value={draft.basis} onChange={event => setDraft({ ...draft, basis: event.target.value as RiderHistoryFilters['basis'] })}><option value="created">Booking created</option><option value="finished">Job finished</option></select></label>
            <label>{draft.basis === 'finished' ? 'Completed/cancelled date' : 'Booking date'} (PH time)<input ref={dateField} type="date" defaultValue={date}/></label>
            {draft.basis === 'finished' && <p className="rd-help">Matches the recorded completion or cancellation date.</p>}
          </div>
          <div className="rd-filter-actions">
            <Button type="button" variant="outline" onClick={() => {
              setDraft(EMPTY_HISTORY_FILTERS);
              if (dateField.current) dateField.current.value = '';
            }}>Reset</Button>
            <Button type="submit">Apply filters</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    {!!labels.length && <p className="rd-help w-full" role="status">{labels.join(' · ')}</p>}
  </div>;
}
