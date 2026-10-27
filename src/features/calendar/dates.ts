export type View = 'month' | 'week' | 'day';

export function keyOf(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function dateAt(key: string) { const [year, month, day] = key.split('-').map(Number); return new Date(year!, month! - 1, day!, 12); }
export function addDays(date: Date, count: number) { const next = new Date(date); next.setDate(next.getDate() + count); return next; }
export function startOfWeek(date: Date) { return addDays(date, -date.getDay()); }
export function boundsFor(view: View, selected: Date) {
  let from: Date; let to: Date;
  if (view === 'day') { from = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate()); to = addDays(from, 1); }
  else if (view === 'week') { from = startOfWeek(selected); to = addDays(from, 7); }
  else { from = startOfWeek(new Date(selected.getFullYear(), selected.getMonth(), 1)); to = addDays(from, 42); }
  return { from: from.toISOString(), to: to.toISOString() };
}
export function shiftDate(date: Date, view: View, amount: number) { const next = new Date(date); if (view === 'month') { const day = next.getDate(); next.setDate(1); next.setMonth(next.getMonth() + amount); next.setDate(Math.min(day, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate())); } else next.setDate(next.getDate() + amount * (view === 'week' ? 7 : 1)); return next; }
