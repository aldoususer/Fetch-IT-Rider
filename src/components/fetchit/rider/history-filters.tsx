'use client';
import { Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function HistoryFilters({ query, status, date, basis = 'created', open, onQuery, onStatus, onDate, onBasis, onToggle, onClear }: {
  query: string; status: string; date: string; open: boolean;
  basis?: 'created' | 'finished'; onBasis?: (basis: 'created' | 'finished') => void;
  onQuery: (value: string) => void; onStatus: (value: string) => void; onDate: (value: string) => void;
  onToggle: () => void; onClear: () => void;
}) {
  const count = Number(status !== 'ALL') + Number(!!date);
  return <div className="rd-history-tools">
    <div className="rd-search"><Search size={18} aria-hidden="true"/><label className="sr-only" htmlFor="rider-history-search">Search booking history</label><input id="rider-history-search" type="search" placeholder="Search reference or address" value={query} onChange={event => onQuery(event.target.value)}/></div>
    <Button variant="outline" aria-label="Filter booking history" aria-expanded={open} aria-controls="rider-history-filters" onClick={onToggle}><SlidersHorizontal size={18} aria-hidden="true"/>Filters{count ? ` · ${count}` : ''}</Button>
    {date && <p className="rd-help w-full" role="status">{basis === 'finished' ? 'Completed/cancelled' : 'Booked'}: {new Date(`${date}T00:00:00+08:00`).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' })} · PH time</p>}
    {open && <div id="rider-history-filters" className="rd-history-filters">
      <label>Status<select value={status} onChange={event => onStatus(event.target.value)}><option value="ALL">All bookings</option><option value="DELIVERED">Completed</option><option value="CANCELLED">Cancelled</option></select></label>
      <label>Date based on<select value={basis} onChange={event => onBasis?.(event.target.value as 'created' | 'finished')}><option value="created">Booking created</option><option value="finished">Job finished</option></select></label>
      <label>{basis === 'finished' ? 'Completed/cancelled date' : 'Booking date'} (PH time)<input type="date" value={date} onChange={event => onDate(event.target.value)}/></label>
      {basis === 'finished' && <p className="rd-help w-full">Only jobs with a recorded completion or cancellation time match this date.</p>}
      <Button className="min-h-12" variant="ghost" onClick={onClear}>Clear filters</Button>
    </div>}
  </div>;
}
