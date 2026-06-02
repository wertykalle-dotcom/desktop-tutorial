import { formatLocalDate, formatLocalDateTime, formatRelativeTime, parseUtcDate } from '../../../src/utils/time';

describe('time utils', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-03T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('parses valid UTC date strings', () => {
    const date = parseUtcDate('2026-06-03T11:55:00.000Z');
    expect(date).not.toBeNull();
    expect(date?.toISOString()).toBe('2026-06-03T11:55:00.000Z');
  });

  test('returns null for invalid dates', () => {
    expect(parseUtcDate('not-a-date')).toBeNull();
  });

  test('formats recent past times relatively', () => {
    expect(formatRelativeTime('2026-06-03T11:55:00.000Z')).toBe('5 minuuttia sitten');
  });

  test('formats recent future times relatively', () => {
    expect(formatRelativeTime('2026-06-03T12:05:00.000Z')).toBe('5 minuutin kuluttua');
  });

  test('falls back to local date for older values', () => {
    const dateText = formatLocalDate('2026-05-20T12:00:00.000Z');
    expect(dateText).toMatch(/\d/);
    expect(formatLocalDateTime('2026-05-20T12:00:00.000Z')).toContain('.');
  });
});
