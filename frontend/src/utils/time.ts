const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const hasRelativeTimeFormat = typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function';

const relativeFormatter = hasRelativeTimeFormat
  ? new Intl.RelativeTimeFormat('fi-FI', {
      numeric: 'auto',
      style: 'long',
    })
  : null;

const formatRelativeTimeFallback = (value: number, unit: 'minute' | 'hour' | 'day' | 'week'): string => {
  const absValue = Math.abs(value);
  const suffix = value < 0 ? 'sitten' : 'kuluttua';

  if (unit === 'minute') {
    if (absValue === 1) return value < 0 ? '1 minuutti sitten' : '1 minuutin kuluttua';
    return `${absValue} minuuttia ${suffix}`;
  }

  if (unit === 'hour') {
    if (absValue === 1) return value < 0 ? '1 tunti sitten' : '1 tunnin kuluttua';
    return `${absValue} tuntia ${suffix}`;
  }

  if (unit === 'day') {
    if (absValue === 1) return value < 0 ? '1 päivä sitten' : '1 päivän kuluttua';
    return `${absValue} päivää ${suffix}`;
  }

  if (absValue === 1) return value < 0 ? '1 viikko sitten' : '1 viikon kuluttua';
  return `${absValue} viikkoa ${suffix}`;
};

export function parseUtcDate(input?: string | null): Date | null {
  if (!input) return null;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRelativeTime(input?: string | null): string {
  const date = parseUtcDate(input);
  if (!date) return '';

  const diff = date.getTime() - Date.now();
  const absDiff = Math.abs(diff);

  if (absDiff < MINUTE_MS) {
    return diff < 0 ? 'juuri nyt' : 'hetken kuluttua';
  }

  if (absDiff < HOUR_MS) {
    const minutes = Math.round(diff / MINUTE_MS);
    return relativeFormatter ? relativeFormatter.format(minutes, 'minute') : formatRelativeTimeFallback(minutes, 'minute');
  }

  if (absDiff < DAY_MS) {
    const hours = Math.round(diff / HOUR_MS);
    return relativeFormatter ? relativeFormatter.format(hours, 'hour') : formatRelativeTimeFallback(hours, 'hour');
  }

  if (absDiff < WEEK_MS) {
    const days = Math.round(diff / DAY_MS);
    return relativeFormatter ? relativeFormatter.format(days, 'day') : formatRelativeTimeFallback(days, 'day');
  }

  const weeks = Math.round(diff / WEEK_MS);
  return relativeFormatter ? relativeFormatter.format(weeks, 'week') : formatRelativeTimeFallback(weeks, 'week');
}

export function formatLocalDateTime(input?: string | null): string {
  const date = parseUtcDate(input);
  if (!date) return '';
  return date.toLocaleString('fi-FI');
}

export function formatLocalDate(input?: string | null): string {
  const date = parseUtcDate(input);
  if (!date) return '';
  return date.toLocaleDateString('fi-FI');
}
