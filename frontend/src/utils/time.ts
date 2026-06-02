const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const relativeFormatter = new Intl.RelativeTimeFormat('fi-FI', {
  numeric: 'auto',
  style: 'long',
});

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
    return relativeFormatter.format(minutes, 'minute');
  }

  if (absDiff < DAY_MS) {
    const hours = Math.round(diff / HOUR_MS);
    return relativeFormatter.format(hours, 'hour');
  }

  if (absDiff < WEEK_MS) {
    const days = Math.round(diff / DAY_MS);
    return relativeFormatter.format(days, 'day');
  }

  const weeks = Math.round(diff / WEEK_MS);
  return relativeFormatter.format(weeks, 'week');
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
