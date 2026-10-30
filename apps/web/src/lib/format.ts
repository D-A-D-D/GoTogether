// Small display helpers, pure so they can be tested. India is the first market (docs/ROADMAP.md,
// Open decisions #5), so money is shown in rupees with the Indian grouping (1,25,000).

const MS_PER_DAY = 86_400_000;

export function formatMoney(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

export function formatBudget(min: number, max: number): string {
  return min === max ? formatMoney(min) : `${formatMoney(min)} – ${formatMoney(max)}`;
}

/** Whole days a trip covers, counting both its first and last day. */
export function tripDays(startIso: string, endIso: string): number {
  const start = Date.UTC(...ymd(startIso));
  const end = Date.UTC(...ymd(endIso));
  return Math.max(1, Math.round((end - start) / MS_PER_DAY) + 1);
}

function ymd(iso: string): [number, number, number] {
  const d = new Date(iso);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}

/** "12 Feb – 17 Feb", or "12 – 17 Feb" within one month. Dates are shown as the calendar days they were entered as. */
export function formatDateRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day = (d: Date) => d.getUTCDate();
  const month = (d: Date) => new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(d);
  if (start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()) {
    return day(start) === day(end) ? `${day(start)} ${month(start)}` : `${day(start)} – ${day(end)} ${month(start)}`;
  }
  return `${day(start)} ${month(start)} – ${day(end)} ${month(end)}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Today", "Yesterday", or a date: for the dividers in a conversation. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(date)) / MS_PER_DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(date);
}
