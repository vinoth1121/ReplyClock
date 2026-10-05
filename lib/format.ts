/**
 * ReplyClock presentation formatters.
 *
 * Every export here is pure: no clock reads, no locale surprises from implicit
 * ambient state, no mutation of arguments. Non-finite and negative inputs are
 * clamped rather than thrown on, because these run against seed data.
 */

/** Rupee sign, kept as an escape so the module stays byte-stable. */
const RUPEE_SIGN = '\u20B9';

/** Horizontal ellipsis, used by {@link truncate}. */
const ELLIPSIS = '\u2026';

/** Non-breaking / narrow spaces some ICU builds emit around a currency sign. */
const SPACE_RUN = /[\s\u00A0\u202F]+/g;

/** Currency formatter: `en-IN` grouping, INR, no decimals. */
const INR_CURRENCY = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** Plain grouped digits, used as the fallback path for {@link formatINR}. */
const INR_DIGITS = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
});

/** Short month names; avoids `Intl.DateTimeFormat` and keeps output stable. */
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * True when the platform's currency formatter actually emits the rupee sign.
 * Some minimal ICU builds fall back to the `INR` code instead, in which case
 * {@link formatINR} rebuilds the string by hand.
 */
const CURRENCY_USES_RUPEE = INR_CURRENCY.format(123456).includes(RUPEE_SIGN);

/** Zero pads a non-negative integer to two digits. */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Coerces anything date-like into epoch milliseconds, or `NaN` when unusable. */
function toEpoch(value: Date | number | string): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}

/** Formats an Indian rupee amount with `en-IN` grouping and no decimals. */
export function formatINR(n: number): string {
  if (!Number.isFinite(n)) return `${RUPEE_SIGN}0`;
  const rounded = Math.round(n);
  const magnitude = Math.abs(rounded);
  const sign = rounded < 0 ? '-' : '';
  if (CURRENCY_USES_RUPEE) {
    const formatted = INR_CURRENCY.format(magnitude).replace(SPACE_RUN, '');
    const tail = formatted.startsWith(RUPEE_SIGN) ? formatted.slice(RUPEE_SIGN.length) : '';
    if (tail.length > 0) return `${sign}${RUPEE_SIGN}${tail}`;
  }
  return `${sign}${RUPEE_SIGN}${INR_DIGITS.format(magnitude)}`;
}

/**
 * Compact wait duration for the queue, e.g. `42s`, `9m 05s`, `12m`, `1h 12m`.
 * Seconds are only shown below ten minutes and only when non-zero. Zero or
 * negative input is `0s`.
 */
export function formatWait(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    if (seconds !== 0 && totalMinutes < 10) return `${totalMinutes}m ${pad2(seconds)}s`;
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${pad2(totalMinutes % 60)}m`;
}

/** Compact duration with no seconds at all, e.g. `45s`, `42m`, `1h 12m`. */
export function formatDurationShort(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${pad2(totalMinutes % 60)}m`;
}

/** 24-hour zero-padded wall clock, `HH:MM:SS`, for the status bar. */
export function formatClock(d: Date | number): string {
  const epoch = toEpoch(d);
  if (!Number.isFinite(epoch)) return '00:00:00';
  const date = new Date(epoch);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** Day and short month, e.g. `12 Oct`, with no leading zero on the day. */
export function formatDay(iso: string): string {
  const epoch = toEpoch(iso);
  if (!Number.isFinite(epoch)) return '';
  const date = new Date(epoch);
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''}`;
}

/** Day, short month and 24-hour time, e.g. `12 Oct, 14:32`. */
export function formatDateTime(iso: string): string {
  const epoch = toEpoch(iso);
  if (!Number.isFinite(epoch)) return '';
  const date = new Date(epoch);
  return `${formatDay(iso)}, ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Coarse age of an ISO timestamp relative to an explicit `now`, e.g.
 * `just now`, `3m ago`, `2h ago`, `4d ago`. Anything under ten seconds is
 * `just now`; unparseable input is `unknown`.
 */
export function formatRelative(iso: string, now: number): string {
  const epoch = toEpoch(iso);
  if (!Number.isFinite(epoch)) return 'unknown';
  const reference = Number.isFinite(now) ? now : epoch;
  const elapsed = reference - epoch;
  if (elapsed < 10_000) return 'just now';
  const totalSeconds = Math.floor(elapsed / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s ago`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Renders a digits-only phone string, e.g. `919812345678` becomes
 * `+91 98123 45678`. Bare ten-digit Indian numbers gain a `+91`, `00`
 * international prefixes are normalised, and any other length falls back to a
 * plain `+` prefix. Never throws.
 */
export function formatPhone(digits: string): string {
  if (typeof digits !== 'string') return '';
  const cleaned = digits.replace(/\D+/g, '');
  if (cleaned.length === 0) return '';
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    return `+91 ${cleaned.slice(2, 7)} ${cleaned.slice(7)}`;
  }
  if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) {
    return `+91 ${cleaned.slice(0, 5)} ${cleaned.slice(5)}`;
  }
  if (cleaned.length > 2 && cleaned.startsWith('00')) {
    const international = cleaned.slice(2);
    if (international.length > 6) {
      return `+${international.slice(0, international.length - 6)} ${international.slice(-6)}`;
    }
    return `+${international}`;
  }
  return `+${cleaned}`;
}

/** Whole-number percentage, e.g. `42.4` becomes `42%`. */
export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '0%';
  return `${Math.round(n)}%`;
}

/**
 * Hard truncates to at most `max` characters, spending the last character on a
 * single ellipsis so the result never exceeds `max`.
 */
export function truncate(s: string, max: number): string {
  if (typeof s !== 'string') return '';
  if (!Number.isFinite(max) || max < 1) return '';
  const limit = Math.floor(max);
  if (s.length <= limit) return s;
  if (limit === 1) return ELLIPSIS;
  return `${s.slice(0, limit - 1)}${ELLIPSIS}`;
}
