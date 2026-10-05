/**
 * ReplyClock SLA logic.
 *
 * Every export is pure and side-effect free: `now` is always passed in, so the
 * same inputs always produce the same outputs and the whole surface is directly
 * unit testable. There is no ambient clock read anywhere in this module.
 */

import type { Lead, LeadFilter, SlaState, SortField, StatsPayload } from '@/types';

/** Default first-response SLA, in minutes. */
export const DEFAULT_SLA_MINUTES = 60;

/** Default warn threshold, in minutes. */
export const WARN_MINUTES = 30;

/** Filter sentinel that matches leads with no owner. */
const UNASSIGNED = 'unassigned';

/** Milliseconds in a minute. */
const MS_PER_MINUTE = 60_000;

/** Warn and breach boundaries, in minutes. */
export interface SlaThresholds {
  warnMinutes: number;
  breachMinutes: number;
}

/** Coerces an ISO timestamp into epoch milliseconds, or `NaN` when unusable. */
function epochOf(iso: string): number {
  return new Date(iso).getTime();
}

/** Epoch milliseconds for a value known to be finite, else `0`. */
function safeEpoch(ms: number): number {
  return Number.isFinite(ms) ? ms : 0;
}

/** True median of a numeric sample, rounded to one decimal; `0` when empty. */
function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  const median = sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? upper) + upper) / 2;
  return Math.round(median * 10) / 10;
}

/**
 * Derives warn and breach boundaries from the configured SLA. The SLA is
 * clamped to at least two minutes and non-finite input falls back to
 * {@link DEFAULT_SLA_MINUTES}; warn sits at half the SLA, floored at one
 * minute, and breach is floored at two. So `45` yields `23 / 45`.
 */
export function thresholdsFor(slaMinutes: number): SlaThresholds {
  const safe = Number.isFinite(slaMinutes) ? slaMinutes : DEFAULT_SLA_MINUTES;
  const breachMinutes = Math.max(2, Math.round(safe));
  return {
    warnMinutes: Math.max(1, Math.round(breachMinutes / 2)),
    breachMinutes,
  };
}

/**
 * Milliseconds a lead has been waiting. Once `firstReplyAt` is set the timer is
 * frozen at the final time-to-reply; while it is `null` the timer runs against
 * `now`. Never negative.
 */
export function waitMsFor(lead: Lead, now: number): number {
  const created = safeEpoch(epochOf(lead.createdAt));
  if (lead.firstReplyAt !== null) {
    return Math.max(0, safeEpoch(epochOf(lead.firstReplyAt)) - created);
  }
  return Math.max(0, safeEpoch(now) - created);
}

/** {@link waitMsFor} expressed in minutes. */
export function waitMinutesFor(lead: Lead, now: number): number {
  return waitMsFor(lead, now) / MS_PER_MINUTE;
}

/** True while the lead still has no first reply. */
export function isAwaitingReply(lead: Lead): boolean {
  return lead.firstReplyAt === null;
}

/**
 * True when the lead is still awaiting a reply and its running wait has reached
 * or passed the breach boundary. Replied leads are never breaches.
 */
export function isBreached(lead: Lead, now: number, t: SlaThresholds): boolean {
  return isAwaitingReply(lead) && waitMinutesFor(lead, now) >= t.breachMinutes;
}

/**
 * SLA health of a lead: `breach` at or past the breach boundary, `warn` at or
 * past the warn boundary, otherwise `ok`. Replied leads are always `ok` because
 * their timer has stopped. Both comparisons use `>=`, so exactly the warn
 * boundary is `warn` and exactly the breach boundary is `breach`.
 */
export function slaStateFor(lead: Lead, now: number, t: SlaThresholds): SlaState {
  if (!isAwaitingReply(lead)) return 'ok';
  const minutes = waitMinutesFor(lead, now);
  if (minutes >= t.breachMinutes) return 'breach';
  if (minutes >= t.warnMinutes) return 'warn';
  return 'ok';
}

/**
 * Minutes left before the lead breaches: `breachMinutes` minus the current
 * wait, so a breached lead reports its negative overflow. Resolved leads report
 * `0` because they can never breach again.
 */
export function minutesUntilBreach(lead: Lead, now: number, t: SlaThresholds): number {
  if (!isAwaitingReply(lead)) return 0;
  return t.breachMinutes - waitMinutesFor(lead, now);
}

/**
 * Default queue order, on a copy: leads still awaiting a reply first, then by
 * longest running wait descending, then oldest `createdAt` first as a
 * tiebreak. The thresholds are accepted for signature symmetry with the other
 * helpers and do not affect the ordering.
 */
export function sortByUrgency(leads: Lead[], now: number, _t: SlaThresholds): Lead[] {
  return leads.slice().sort((a, b) => {
    const aAwaiting = isAwaitingReply(a) ? 1 : 0;
    const bAwaiting = isAwaitingReply(b) ? 1 : 0;
    if (aAwaiting !== bAwaiting) return bAwaiting - aAwaiting;
    const byWait = waitMinutesFor(b, now) - waitMinutesFor(a, now);
    if (byWait !== 0) return byWait;
    return safeEpoch(epochOf(a.createdAt)) - safeEpoch(epochOf(b.createdAt));
  });
}

/**
 * Applies every axis of a {@link LeadFilter} and returns a new array. The
 * literal `'all'` means no constraint on that axis; `owner` also accepts
 * `'unassigned'`; `source` and `query` match case-insensitively, with `query`
 * searching name, id, city, source and product.
 */
export function filterLeads(
  leads: Lead[],
  filter: LeadFilter,
  now: number,
  t: SlaThresholds,
): Lead[] {
  const query = filter.query.trim().toLowerCase();
  return leads.filter((lead) => {
    if (filter.stage !== 'all' && lead.stage !== filter.stage) return false;
    if (filter.owner !== 'all') {
      if (filter.owner === UNASSIGNED) {
        if (lead.ownerId !== null) return false;
      } else if (lead.ownerId !== filter.owner) {
        return false;
      }
    }
    if (filter.state !== 'all' && slaStateFor(lead, now, t) !== filter.state) return false;
    if (filter.source !== 'all' && lead.source.toLowerCase() !== filter.source.toLowerCase()) {
      return false;
    }
    if (query.length > 0) {
      const haystack =
        `${lead.name}\u0000${lead.id}\u0000${lead.city}\u0000${lead.source}\u0000${lead.product}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/**
 * Sorts a copy of the leads by the requested field: `wait` is the urgency
 * order, `created` is newest first, `amount` is highest value first, and
 * `name` is a locale comparison.
 */
export function sortLeads(leads: Lead[], field: SortField, now: number, t: SlaThresholds): Lead[] {
  if (field === 'wait') return sortByUrgency(leads, now, t);
  const copy = leads.slice();
  switch (field) {
    case 'created':
      copy.sort((a, b) => safeEpoch(epochOf(b.createdAt)) - safeEpoch(epochOf(a.createdAt)));
      return copy;
    case 'amount':
      copy.sort((a, b) => amountOf(b) - amountOf(a));
      return copy;
    case 'name':
      copy.sort((a, b) => a.name.localeCompare(b.name));
      return copy;
  }
}

/**
 * Headline counters for the console: lead and reply counts, warn and breach
 * counts among still-pending leads, the true median first-response time in
 * minutes over replied leads (`0` when there are none), and the rupee value of
 * every lead that is not yet closed.
 */
export function summarise(leads: Lead[], now: number, t: SlaThresholds): StatsPayload['totals'] {
  const replyMinutes: number[] = [];
  let replied = 0;
  let breached = 0;
  let warn = 0;
  let pipelineInr = 0;

  for (const lead of leads) {
    if (isAwaitingReply(lead)) {
      const state = slaStateFor(lead, now, t);
      if (state === 'breach') breached += 1;
      else if (state === 'warn') warn += 1;
    } else {
      replied += 1;
      replyMinutes.push(waitMinutesFor(lead, now));
    }
    if (lead.stage !== 'closed') pipelineInr += amountOf(lead);
  }

  return {
    leads: leads.length,
    replied,
    pending: leads.length - replied,
    breached,
    warn,
    medianFirstReplyMinutes: medianOf(replyMinutes),
    pipelineInr,
  };
}

/** Lead value, guarding against non-finite amounts. */
function amountOf(lead: Lead): number {
  return Number.isFinite(lead.amountInr) ? lead.amountInr : 0;
}
