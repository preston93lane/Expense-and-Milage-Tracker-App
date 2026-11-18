import dayjs from 'dayjs';

export function money(cents: number, opts: { sign?: boolean; abs?: boolean } = {}): string {
  const v = opts.abs ? Math.abs(cents) : cents;
  const s = (Math.abs(v) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  if (v < 0) return `-${s}`;
  return opts.sign && v > 0 ? `+${s}` : s;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function shortDate(iso: string): string {
  return dayjs(iso).format('MMM D, YYYY');
}

export function dateTime(iso: string): string {
  // SQLite datetime('now') is UTC without a zone marker.
  const d = dayjs(iso.includes('T') || iso.endsWith('Z') ? iso : `${iso.replace(' ', 'T')}Z`);
  return d.format('MMM D, YYYY h:mm A');
}

export function toIso(d: Date | string | null | undefined): string | undefined {
  if (!d) return undefined;
  return dayjs(d).format('YYYY-MM-DD');
}

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit card',
  cash: 'Cash',
  other: 'Other',
};

export interface DatePreset {
  label: string;
  from: string;
  to: string;
}

export function datePresets(today = dayjs()): DatePreset[] {
  const fmt = (d: dayjs.Dayjs) => d.format('YYYY-MM-DD');
  const lastMonth = today.subtract(1, 'month');
  return [
    { label: 'This month', from: fmt(today.startOf('month')), to: fmt(today.endOf('month')) },
    { label: 'Last month', from: fmt(lastMonth.startOf('month')), to: fmt(lastMonth.endOf('month')) },
    { label: 'Year to date', from: fmt(today.startOf('year')), to: fmt(today) },
    { label: 'Last year', from: fmt(today.subtract(1, 'year').startOf('year')), to: fmt(today.subtract(1, 'year').endOf('year')) },
  ];
}
