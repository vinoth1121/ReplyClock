import { describe, it, expect } from 'vitest';

import {
  formatClock,
  formatDateTime,
  formatDay,
  formatDurationShort,
  formatINR,
  formatPct,
  formatPhone,
  formatRelative,
  formatWait,
  truncate,
} from '@/lib/format';

/** Rupee sign, escaped so the assertion text survives any file encoding. */
const RUPEE = '\u20B9';

/** Horizontal ellipsis, the character `truncate` spends the last slot on. */
const ELLIPSIS = '\u2026';

describe('formatINR', () => {
  it('groups whole rupees on the Indian lakh pattern', () => {
    expect(formatINR(123456)).toBe(`${RUPEE}1,23,456`);
    expect(formatINR(100000)).toBe(`${RUPEE}1,00,000`);
    expect(formatINR(1250000)).toBe(`${RUPEE}12,50,000`);
  });

  it('leaves anything under one thousand ungrouped', () => {
    expect(formatINR(999)).toBe(`${RUPEE}999`);
    expect(formatINR(1000)).toBe(`${RUPEE}1,000`);
  });

  it('renders zero as a bare rupee zero', () => {
    expect(formatINR(0)).toBe(`${RUPEE}0`);
  });

  it('never emits decimals, so no amount ends in .00', () => {
    const amounts = [0, 1, 99, 100, 999, 1000, 12345, 123456, 100000, 1250000, 9999999];
    for (const amount of amounts) {
      const formatted = formatINR(amount);
      expect(formatted).not.toContain('.');
      expect(formatted).not.toContain('.00');
    }
  });

  it('rounds fractional rupees to whole rupees', () => {
    expect(formatINR(1234.4)).toBe(`${RUPEE}1,234`);
    expect(formatINR(1234.5)).toBe(`${RUPEE}1,235`);
  });

  it('puts the minus sign in front of the rupee sign', () => {
    expect(formatINR(-50000)).toBe(`-${RUPEE}50,000`);
    expect(formatINR(-1)).toBe(`-${RUPEE}1`);
  });

  it('clamps non-finite amounts to zero rather than throwing', () => {
    expect(formatINR(Number.NaN)).toBe(`${RUPEE}0`);
    expect(formatINR(Number.POSITIVE_INFINITY)).toBe(`${RUPEE}0`);
    expect(formatINR(Number.NEGATIVE_INFINITY)).toBe(`${RUPEE}0`);
  });
});

describe('formatWait', () => {
  it('shows whole seconds below a minute', () => {
    expect(formatWait(42_000)).toBe('42s');
    expect(formatWait(59_000)).toBe('59s');
  });

  it('renders zero and negative input as 0s', () => {
    expect(formatWait(0)).toBe('0s');
    expect(formatWait(-5_000)).toBe('0s');
  });

  it('rounds to the nearest second, so 59.5s reads as a whole minute', () => {
    expect(formatWait(59_500)).toBe('1m');
  });

  it('shows padded seconds under ten minutes when seconds are non-zero', () => {
    expect(formatWait(545_000)).toBe('9m 05s');
    expect(formatWait(9 * 60_000 + 5_000)).toBe('9m 05s');
  });

  it('drops the seconds from ten minutes upwards', () => {
    // Deliberate: the seconds tail exists to make a young wait feel alive, so
    // it is capped at nine minutes. '12m 05s' is not a reachable output and
    // anything at or past 10m reads as a bare minute count.
    expect(formatWait(10 * 60_000)).toBe('10m');
    expect(formatWait(12 * 60_000 + 5_000)).toBe('12m');
    expect(formatWait(725_000)).toBe('12m');
  });

  it('drops the seconds below ten minutes too when they are exactly zero', () => {
    expect(formatWait(60_000)).toBe('1m');
    expect(formatWait(9 * 60_000)).toBe('9m');
  });

  it('switches to hours and padded minutes from one hour up', () => {
    expect(formatWait(3_600_000)).toBe('1h 00m');
    expect(formatWait(4_320_000)).toBe('1h 12m');
    expect(formatWait(3_600_000 + 59_000)).toBe('1h 00m');
  });

  it('clamps a non-finite duration to 0s', () => {
    expect(formatWait(Number.NaN)).toBe('0s');
    expect(formatWait(Number.POSITIVE_INFINITY)).toBe('0s');
  });
});

describe('formatDurationShort', () => {
  it('shows seconds only below a minute', () => {
    expect(formatDurationShort(42_000)).toBe('42s');
  });

  it('drops the seconds from the first minute onwards', () => {
    // Deliberate: this form is used for tile labels, where a seconds tail that
    // ticks every frame makes the number unreadable, so 65s reads '1m'.
    expect(formatDurationShort(65_000)).toBe('1m');
    expect(formatDurationShort(9 * 60_000 + 5_000)).toBe('9m');
  });

  it('uses plain minutes up to an hour, then hours and minutes', () => {
    expect(formatDurationShort(2_520_000)).toBe('42m');
    expect(formatDurationShort(3_600_000)).toBe('1h 00m');
    expect(formatDurationShort(4_320_000)).toBe('1h 12m');
  });

  it('renders zero and negative input as 0s', () => {
    expect(formatDurationShort(0)).toBe('0s');
    expect(formatDurationShort(-1)).toBe('0s');
  });

  it('never carries an s suffix once a minute has passed', () => {
    for (const ms of [60_000, 120_000, 900_000, 3_600_000, 7_200_000]) {
      expect(formatDurationShort(ms)).not.toContain('s');
    }
  });
});

describe('formatClock', () => {
  it('renders 24-hour wall clock time, zero padded', () => {
    expect(formatClock(new Date(2026, 9, 5, 9, 4, 3))).toBe('09:04:03');
    expect(formatClock(new Date(2026, 9, 5, 0, 0, 0))).toBe('00:00:00');
    expect(formatClock(new Date(2026, 9, 5, 13, 45, 9))).toBe('13:45:09');
  });

  it('never rolls past 23 into a 12-hour clock', () => {
    expect(formatClock(new Date(2026, 9, 5, 23, 59, 59))).toBe('23:59:59');
  });

  it('accepts an epoch millisecond value as well as a Date', () => {
    const date = new Date(2026, 9, 5, 7, 8, 9);
    expect(formatClock(date.getTime())).toBe('07:08:09');
  });

  it('falls back to midnight instead of NaN for unusable input', () => {
    expect(formatClock(Number.NaN)).toBe('00:00:00');
    expect(formatClock(new Date('not-a-date'))).toBe('00:00:00');
  });
});

describe('formatDay', () => {
  it('renders the day number and short month with no leading zero', () => {
    expect(formatDay('2026-10-12T14:32:00')).toBe('12 Oct');
    expect(formatDay('2026-01-05T09:00:00')).toBe('5 Jan');
  });

  it('handles the last day of the year', () => {
    expect(formatDay('2026-12-31T23:00:00')).toBe('31 Dec');
  });

  it('returns an empty string for unusable input', () => {
    expect(formatDay('not-a-date')).toBe('');
    expect(formatDay('')).toBe('');
  });
});

describe('formatDateTime', () => {
  it('renders the day, the short month and a 24-hour time', () => {
    expect(formatDateTime('2026-10-12T14:32:00')).toBe('12 Oct, 14:32');
    expect(formatDateTime('2026-01-05T09:07:00')).toBe('5 Jan, 09:07');
  });

  it('zero pads the hour and the minute', () => {
    expect(formatDateTime('2026-10-12T04:05:00')).toBe('12 Oct, 04:05');
  });

  it('returns an empty string for unusable input', () => {
    expect(formatDateTime('tomorrow-ish')).toBe('');
    expect(formatDateTime('')).toBe('');
  });
});

describe('formatRelative', () => {
  /** Fixed reference point so no assertion depends on the wall clock. */
  const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);

  /** ISO timestamp `ms` milliseconds before {@link NOW}. */
  const ago = (ms: number): string => new Date(NOW - ms).toISOString();

  it('reports anything under ten seconds as just now', () => {
    expect(formatRelative(ago(0), NOW)).toBe('just now');
    expect(formatRelative(ago(9_999), NOW)).toBe('just now');
  });

  it('reports seconds up to a minute', () => {
    expect(formatRelative(ago(10_000), NOW)).toBe('10s ago');
    expect(formatRelative(ago(59_000), NOW)).toBe('59s ago');
  });

  it('reports whole minutes up to an hour', () => {
    expect(formatRelative(ago(60_000), NOW)).toBe('1m ago');
    expect(formatRelative(ago(3 * 60_000), NOW)).toBe('3m ago');
    expect(formatRelative(ago(59 * 60_000), NOW)).toBe('59m ago');
  });

  it('reports whole hours up to a day', () => {
    expect(formatRelative(ago(3_600_000), NOW)).toBe('1h ago');
    expect(formatRelative(ago(23 * 3_600_000), NOW)).toBe('23h ago');
  });

  it('reports whole days past a day', () => {
    expect(formatRelative(ago(24 * 3_600_000), NOW)).toBe('1d ago');
    expect(formatRelative(ago(9 * 24 * 3_600_000), NOW)).toBe('9d ago');
  });

  it('treats a future timestamp as just now rather than a negative age', () => {
    expect(formatRelative(ago(-60_000), NOW)).toBe('just now');
  });

  it('returns unknown for an unparseable ISO string', () => {
    expect(formatRelative('not-a-date', NOW)).toBe('unknown');
    expect(formatRelative('', NOW)).toBe('unknown');
  });
});

describe('formatPhone', () => {
  it('splits a twelve digit number that already carries the 91 country code', () => {
    expect(formatPhone('919812345678')).toBe('+91 98123 45678');
  });

  it('adds the country code to a bare ten digit mobile', () => {
    expect(formatPhone('9812345678')).toBe('+91 98123 45678');
  });

  it('ignores spaces, dashes, brackets and a leading plus', () => {
    expect(formatPhone('+91 98123 45678')).toBe('+91 98123 45678');
    expect(formatPhone('(98123) 45678')).toBe('+91 98123 45678');
    expect(formatPhone('91-98123-45678')).toBe('+91 98123 45678');
  });

  it('normalises a 00 international prefix into a plus country code', () => {
    expect(formatPhone('001234567890')).toBe('+1234 567890');
  });

  it('falls back to a plain plus prefix for an unrecognised length', () => {
    expect(formatPhone('5511987654321')).toBe('+5511987654321');
  });

  it('returns an empty string when no digits survive', () => {
    expect(formatPhone('')).toBe('');
    expect(formatPhone('not a phone')).toBe('');
  });
});

describe('formatPct', () => {
  it('rounds to the nearest whole percent', () => {
    expect(formatPct(42.4)).toBe('42%');
    expect(formatPct(42.5)).toBe('43%');
    expect(formatPct(99.9)).toBe('100%');
  });

  it('renders zero as 0%', () => {
    expect(formatPct(0)).toBe('0%');
  });

  it('keeps the sign on a negative percentage', () => {
    expect(formatPct(-3.6)).toBe('-4%');
  });

  it('reports non-finite input as 0%', () => {
    expect(formatPct(Number.NaN)).toBe('0%');
    expect(formatPct(Number.POSITIVE_INFINITY)).toBe('0%');
  });
});

describe('truncate', () => {
  it('leaves a string that already fits untouched', () => {
    expect(truncate('Swift', 10)).toBe('Swift');
    expect(truncate('Swift', 5)).toBe('Swift');
  });

  it('spends the last character on a single ellipsis', () => {
    expect(truncate('Hello world', 8)).toBe(`Hello w${ELLIPSIS}`);
  });

  it('never returns more than max characters', () => {
    for (const max of [1, 2, 3, 5, 8, 13]) {
      expect(truncate('A very long lead name indeed', max).length).toBeLessThanOrEqual(max);
    }
  });

  it('adds exactly one ellipsis, and only at the end', () => {
    const out = truncate('A very long lead name indeed', 10);
    expect(out.endsWith(ELLIPSIS)).toBe(true);
    expect(out.split(ELLIPSIS)).toHaveLength(2);
  });

  it('returns just an ellipsis when max is one', () => {
    expect(truncate('A very long lead name indeed', 1)).toBe(ELLIPSIS);
  });

  it('floors a fractional max before truncating', () => {
    expect(truncate('abcd', 2.9)).toBe(`a${ELLIPSIS}`);
  });

  it('returns an empty string for a max below one', () => {
    expect(truncate('abcd', 0)).toBe('');
    expect(truncate('abcd', -5)).toBe('');
    expect(truncate('abcd', Number.NaN)).toBe('');
  });
});
