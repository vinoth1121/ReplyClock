import { describe, it, expect } from 'vitest';
import type { Lead, LeadFilter, SlaState, SortField } from '@/types';
import {
  DEFAULT_SLA_MINUTES,
  WARN_MINUTES,
  filterLeads,
  isAwaitingReply,
  isBreached,
  minutesUntilBreach,
  sortByUrgency,
  sortLeads,
  slaStateFor,
  summarise,
  thresholdsFor,
  waitMinutesFor,
  waitMsFor,
} from '@/lib/sla';

const MINUTE = 60_000;

/**
 * Fixed clock for the whole file: 2026-10-05T10:30:00Z. Nothing in `lib/sla`
 * reads a clock, so every assertion below is reproducible.
 */
const NOW = Date.UTC(2026, 9, 5, 10, 30, 0);

/** Warn 30 / breach 60, the out-of-the-box console configuration. */
const DEFAULT_THRESHOLDS = thresholdsFor(DEFAULT_SLA_MINUTES);

/** Everything the fixture builder can vary. Only id and createdMinutesAgo are required. */
interface LeadSpec {
  id: string;
  /** Minutes before NOW that the lead was created. */
  createdMinutesAgo: number;
  /**
   * Minutes between creation and the first reply. Omit it, or pass `null`, for
   * a lead that is still waiting for a reply.
   */
  repliedAfterMinutes?: number | null;
  name?: string;
  city?: string;
  source?: string;
  product?: string;
  stage?: 'new' | 'talks' | 'negotiation' | 'closed';
  ownerId?: string | null;
  amountInr?: number;
}

/**
 * Minimal typed `Lead` fixture, built by hand rather than pulled from
 * `lib/seed.ts` so this file stays hermetic and fast: no dependency on the
 * size, shape or drift of the seed dataset.
 */
function buildLead(spec: LeadSpec): Lead {
  const created = NOW - spec.createdMinutesAgo * MINUTE;
  const repliedAfter = spec.repliedAfterMinutes;
  const firstReplyAt =
    repliedAfter === undefined || repliedAfter === null
      ? null
      : new Date(created + repliedAfter * MINUTE).toISOString();
  return {
    id: spec.id,
    name: spec.name ?? spec.id,
    city: spec.city ?? 'Pune',
    phone: '919812345678',
    source: spec.source ?? 'CTWA-Diwali-Offer',
    stage: spec.stage ?? 'new',
    ownerId: spec.ownerId === undefined ? 'TM-1' : spec.ownerId,
    product: spec.product ?? 'Swift',
    amountInr: spec.amountInr ?? 100_000,
    createdAt: new Date(created).toISOString(),
    firstReplyAt,
    transcript: [],
    timeline: [],
    notes: [],
  };
}

/** A lead still waiting for its first reply, `waitedMinutes` old as of NOW. */
function awaiting(id: string, waitedMinutes: number, extra: Partial<LeadSpec> = {}): Lead {
  return buildLead({
    id,
    createdMinutesAgo: waitedMinutes,
    repliedAfterMinutes: null,
    ...extra,
  });
}

/** A lead whose first reply landed `replyMinutes` after it was created. */
function replied(id: string, replyMinutes: number, extra: Partial<LeadSpec> = {}): Lead {
  return buildLead({
    id,
    createdMinutesAgo: 600,
    repliedAfterMinutes: replyMinutes,
    ...extra,
  });
}

/** A filter with every axis wide open, so each test only states its own axis. */
function only(overrides: Partial<LeadFilter> = {}): LeadFilter {
  return { stage: 'all', owner: 'all', state: 'all', source: 'all', query: '', ...overrides };
}

/** Ids in their current order, for asserting a sort left the input alone. */
function idsOf(leads: readonly Lead[]): string[] {
  return leads.map((lead) => lead.id);
}

describe('thresholdsFor', () => {
  it('warns at half of the 60 minute default', () => {
    expect(DEFAULT_SLA_MINUTES).toBe(60);
    expect(WARN_MINUTES).toBe(30);
    expect(thresholdsFor(DEFAULT_SLA_MINUTES)).toEqual({
      warnMinutes: 30,
      breachMinutes: 60,
    });
  });

  it('rounds an odd SLA, so 45 becomes warn 23 / breach 45', () => {
    expect(thresholdsFor(45)).toEqual({ warnMinutes: 23, breachMinutes: 45 });
  });

  it('warns below breach on the shortest legal SLAs', () => {
    expect(thresholdsFor(2)).toEqual({ warnMinutes: 1, breachMinutes: 2 });
    expect(thresholdsFor(3)).toEqual({ warnMinutes: 2, breachMinutes: 3 });
  });

  it('clamps the breach boundary up to two minutes', () => {
    // A one minute SLA would warn and breach on the same tick, which is
    // unreadable, so the floor is two minutes and warn becomes one.
    expect(thresholdsFor(1)).toEqual({ warnMinutes: 1, breachMinutes: 2 });
    expect(thresholdsFor(0)).toEqual({ warnMinutes: 1, breachMinutes: 2 });
    expect(thresholdsFor(-90)).toEqual({ warnMinutes: 1, breachMinutes: 2 });
  });

  it('rounds a fractional SLA before halving and clamping it', () => {
    expect(thresholdsFor(4.4)).toEqual({ warnMinutes: 2, breachMinutes: 4 });
    expect(thresholdsFor(4.6)).toEqual({ warnMinutes: 3, breachMinutes: 5 });
    expect(thresholdsFor(2.4)).toEqual({ warnMinutes: 1, breachMinutes: 2 });
  });

  it('falls back to the default SLA for non-finite input', () => {
    expect(thresholdsFor(Number.NaN)).toEqual({ warnMinutes: 30, breachMinutes: 60 });
    expect(thresholdsFor(Number.POSITIVE_INFINITY)).toEqual({
      warnMinutes: 30,
      breachMinutes: 60,
    });
    expect(thresholdsFor(Number.NEGATIVE_INFINITY)).toEqual({
      warnMinutes: 30,
      breachMinutes: 60,
    });
  });

  it('keeps warn between one minute and breach across the whole editable range', () => {
    for (let minutes = 2; minutes <= 1440; minutes += 1) {
      const t = thresholdsFor(minutes);
      expect(t.warnMinutes).toBeGreaterThanOrEqual(1);
      expect(t.warnMinutes).toBeLessThanOrEqual(t.breachMinutes);
      expect(t.breachMinutes).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('waitMsFor', () => {
  it('measures an awaiting lead against the supplied now', () => {
    const lead = awaiting('LD-1', 12);
    expect(waitMsFor(lead, NOW)).toBe(12 * MINUTE);
    expect(waitMinutesFor(lead, NOW)).toBe(12);
  });

  it('keeps growing with now while the lead is still waiting', () => {
    const lead = awaiting('LD-2', 12);
    expect(waitMsFor(lead, NOW + 8 * MINUTE)).toBe(20 * MINUTE);
  });

  it('freezes at firstReplyAt once the lead has been replied to', () => {
    // The core guarantee of the product: a lead answered at 6m keeps reporting
    // 6m forever instead of drifting on towards the breach line.
    const lead = replied('LD-3', 6);
    expect(waitMsFor(lead, NOW)).toBe(6 * MINUTE);
    expect(waitMsFor(lead, NOW + 10 * 60 * MINUTE)).toBe(6 * MINUTE);
    expect(waitMinutesFor(lead, NOW + 10 * 60 * MINUTE)).toBe(6);
  });

  it('never reports a negative wait, even when now precedes creation', () => {
    expect(waitMsFor(awaiting('LD-4', 5), NOW - 30 * MINUTE)).toBe(0);
  });

  it('degrades a non-finite now or an unparseable reply timestamp to a zero wait', () => {
    expect(waitMsFor(awaiting('LD-5', 5), Number.NaN)).toBe(0);
    expect(waitMsFor({ ...awaiting('LD-6', 5), firstReplyAt: 'not-a-date' }, NOW)).toBe(0);
  });
});

describe('isAwaitingReply', () => {
  it('is true only while firstReplyAt is null', () => {
    expect(isAwaitingReply(awaiting('LD-10', 5))).toBe(true);
    expect(isAwaitingReply(replied('LD-11', 5))).toBe(false);
  });
});

describe('isBreached', () => {
  it('is true once an awaiting lead reaches the breach boundary', () => {
    expect(isBreached(awaiting('LD-12', 60), NOW, DEFAULT_THRESHOLDS)).toBe(true);
  });

  it('is false one minute short of the boundary', () => {
    expect(isBreached(awaiting('LD-13', 59), NOW, DEFAULT_THRESHOLDS)).toBe(false);
  });

  it('respects a narrowed SLA', () => {
    expect(isBreached(awaiting('LD-14', 45), NOW, thresholdsFor(45))).toBe(true);
    expect(isBreached(awaiting('LD-15', 45), NOW, DEFAULT_THRESHOLDS)).toBe(false);
  });

  it('is never true for a replied lead, however long the recorded wait', () => {
    // Deliberate: the timer stops on first reply, so a resolved lead can never
    // sit in the breach column or be counted against the seller.
    expect(isBreached(replied('LD-16', 600), NOW, DEFAULT_THRESHOLDS)).toBe(false);
  });
});

describe('slaStateFor', () => {
  it('returns warn at exactly the warn threshold', () => {
    expect(slaStateFor(awaiting('LD-20', 30), NOW, DEFAULT_THRESHOLDS)).toBe('warn');
  });

  it('returns ok one minute below the warn threshold', () => {
    expect(slaStateFor(awaiting('LD-21', 29), NOW, DEFAULT_THRESHOLDS)).toBe('ok');
  });

  it('returns warn on the last minute before breach', () => {
    expect(slaStateFor(awaiting('LD-22', 59), NOW, DEFAULT_THRESHOLDS)).toBe('warn');
  });

  it('returns breach at exactly the breach threshold', () => {
    expect(slaStateFor(awaiting('LD-23', 60), NOW, DEFAULT_THRESHOLDS)).toBe('breach');
  });

  it('stays breach past the threshold', () => {
    expect(slaStateFor(awaiting('LD-24', 600), NOW, DEFAULT_THRESHOLDS)).toBe('breach');
  });

  it('returns ok for a lead that has only just arrived', () => {
    expect(slaStateFor(awaiting('LD-25', 0), NOW, DEFAULT_THRESHOLDS)).toBe('ok');
  });

  it('returns ok for every replied lead, whatever its recorded wait', () => {
    // Deliberate: a resolved lead has nothing left to breach, so it leaves the
    // warn and breach columns the instant the first reply lands.
    expect(slaStateFor(replied('LD-26', 600), NOW, DEFAULT_THRESHOLDS)).toBe('ok');
    expect(slaStateFor(replied('LD-27', 1), NOW, DEFAULT_THRESHOLDS)).toBe('ok');
  });

  it('never downgrades the state as the wait grows', () => {
    const rank: Record<SlaState, number> = { ok: 0, warn: 1, breach: 2 };
    let previous = 0;
    for (let minutes = 0; minutes <= 120; minutes += 1) {
      const current =
        rank[slaStateFor(awaiting(`LD-R${minutes}`, minutes), NOW, DEFAULT_THRESHOLDS)];
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe('minutesUntilBreach', () => {
  it('counts down the whole SLA for a brand new lead', () => {
    expect(minutesUntilBreach(awaiting('LD-30', 0), NOW, DEFAULT_THRESHOLDS)).toBe(60);
    expect(minutesUntilBreach(awaiting('LD-31', 20), NOW, DEFAULT_THRESHOLDS)).toBe(40);
  });

  it('reaches zero exactly at the breach boundary', () => {
    expect(minutesUntilBreach(awaiting('LD-32', 60), NOW, DEFAULT_THRESHOLDS)).toBe(0);
  });

  it('reports the negative overflow once the lead has breached', () => {
    expect(minutesUntilBreach(awaiting('LD-33', 75), NOW, DEFAULT_THRESHOLDS)).toBe(-15);
  });

  it('scales the countdown to a narrowed SLA', () => {
    expect(minutesUntilBreach(awaiting('LD-34', 20), NOW, thresholdsFor(45))).toBe(25);
  });

  it('reports zero for a replied lead, which can never breach again', () => {
    // Deliberate: a resolved lead has no pending breach, so the countdown is
    // neutral rather than a large negative the console would have to special case.
    expect(minutesUntilBreach(replied('LD-35', 600), NOW, DEFAULT_THRESHOLDS)).toBe(0);
  });
});

describe('sortByUrgency', () => {
  it('puts leads still awaiting a reply ahead of leads already replied to', () => {
    const leads = [replied('LD-r', 4), awaiting('LD-a', 2)];
    expect(idsOf(sortByUrgency(leads, NOW, DEFAULT_THRESHOLDS))).toEqual(['LD-a', 'LD-r']);
  });

  it('orders the longest running wait first within the awaiting group', () => {
    const leads = [awaiting('LD-s', 5), awaiting('LD-m', 45), awaiting('LD-l', 95)];
    expect(idsOf(sortByUrgency(leads, NOW, DEFAULT_THRESHOLDS))).toEqual(['LD-l', 'LD-m', 'LD-s']);
  });

  it('breaks an exact wait tie with the older created lead first', () => {
    // Two replied leads can share a 6m wait while having been created at very
    // different times, which is the only case this tiebreak can actually fire.
    const leads = [
      replied('LD-newer-created', 6, { createdMinutesAgo: 50 }),
      replied('LD-older-created', 6, { createdMinutesAgo: 100 }),
    ];
    expect(idsOf(sortByUrgency(leads, NOW, DEFAULT_THRESHOLDS))).toEqual([
      'LD-older-created',
      'LD-newer-created',
    ]);
  });

  it('does not mutate or reorder the input array', () => {
    const leads = [awaiting('LD-3', 3), replied('LD-1', 1), awaiting('LD-2', 2)];
    const before = idsOf(leads);
    const sorted = sortByUrgency(leads, NOW, DEFAULT_THRESHOLDS);
    expect(idsOf(leads)).toEqual(before);
    expect(sorted).not.toBe(leads);
    expect(idsOf(sorted)).toEqual(['LD-3', 'LD-2', 'LD-1']);
  });

  it('ignores the thresholds argument, so the order is SLA independent', () => {
    const leads = [awaiting('LD-1', 50), awaiting('LD-2', 10), replied('LD-3', 2)];
    expect(idsOf(sortByUrgency(leads, NOW, thresholdsFor(2)))).toEqual(
      idsOf(sortByUrgency(leads, NOW, thresholdsFor(1440))),
    );
  });
});

describe('filterLeads', () => {
  const LEADS: Lead[] = [
    buildLead({
      id: 'LD-1001',
      name: 'Anil Kumar',
      city: 'Pune',
      product: 'Swift',
      stage: 'new',
      ownerId: 'TM-1',
      source: 'CTWA-Diwali-Offer',
      amountInr: 100_000,
      createdMinutesAgo: 5,
      repliedAfterMinutes: null,
    }),
    buildLead({
      id: 'LD-1002',
      name: 'Bina Shah',
      city: 'Mumbai',
      product: 'Baleno',
      stage: 'talks',
      ownerId: null,
      source: 'ctwa-loan-emi-0',
      amountInr: 250_000,
      createdMinutesAgo: 75,
      repliedAfterMinutes: null,
    }),
    buildLead({
      id: 'LD-1003',
      name: 'Chirag Patil',
      city: 'Nashik',
      product: 'Brezza',
      stage: 'closed',
      ownerId: 'TM-2',
      source: 'CTWA-Same-Day-Install',
      amountInr: 350_000,
      createdMinutesAgo: 600,
      repliedAfterMinutes: 12,
    }),
    buildLead({
      id: 'LD-1004',
      name: 'Deepa Rao',
      city: 'Pune',
      product: 'Ertiga',
      stage: 'negotiation',
      ownerId: 'TM-1',
      source: 'CTWA-Loan-EMI-0',
      amountInr: 400_000,
      createdMinutesAgo: 35,
      repliedAfterMinutes: null,
    }),
  ];

  const matching = (f: LeadFilter): string[] =>
    idsOf(filterLeads(LEADS, f, NOW, DEFAULT_THRESHOLDS));

  it('keeps every lead when all five axes are unset', () => {
    expect(matching(only())).toEqual(['LD-1001', 'LD-1002', 'LD-1003', 'LD-1004']);
  });

  it('filters by stage', () => {
    expect(matching(only({ stage: 'new' }))).toEqual(['LD-1001']);
    expect(matching(only({ stage: 'talks' }))).toEqual(['LD-1002']);
    expect(matching(only({ stage: 'negotiation' }))).toEqual(['LD-1004']);
    expect(matching(only({ stage: 'closed' }))).toEqual(['LD-1003']);
  });

  it('filters by owner id and by the unassigned sentinel', () => {
    expect(matching(only({ owner: 'TM-1' }))).toEqual(['LD-1001', 'LD-1004']);
    expect(matching(only({ owner: 'TM-2' }))).toEqual(['LD-1003']);
    expect(matching(only({ owner: 'unassigned' }))).toEqual(['LD-1002']);
  });

  it('treats stage all, owner all, state all and source all as no constraint', () => {
    expect(
      matching(only({ stage: 'all', owner: 'all', state: 'all', source: 'all' })),
    ).toHaveLength(4);
  });

  it('filters by derived SLA state, counting a replied lead as ok', () => {
    expect(matching(only({ state: 'breach' }))).toEqual(['LD-1002']);
    expect(matching(only({ state: 'warn' }))).toEqual(['LD-1004']);
    expect(matching(only({ state: 'ok' }))).toEqual(['LD-1001', 'LD-1003']);
  });

  it('matches source case-insensitively in both directions', () => {
    // LD-1002 stores its ad name in lower case and LD-1004 in title case, so a
    // correct case-insensitive axis has to return both for either spelling.
    expect(matching(only({ source: 'CTWA-Loan-EMI-0' }))).toEqual(['LD-1002', 'LD-1004']);
    expect(matching(only({ source: 'ctwa-loan-emi-0' }))).toEqual(['LD-1002', 'LD-1004']);
    expect(matching(only({ source: 'CTWA-loan-EMI-0' }))).toEqual(['LD-1002', 'LD-1004']);
    expect(matching(only({ source: 'ctwa-same-day-install' }))).toEqual(['LD-1003']);
    expect(matching(only({ source: 'CTWA-Diwali-Offer' }))).toEqual(['LD-1001']);
  });

  it('searches name, id, city, source and product case-insensitively', () => {
    expect(matching(only({ query: 'anil' }))).toEqual(['LD-1001']);
    expect(matching(only({ query: 'ANIL KUMAR' }))).toEqual(['LD-1001']);
    expect(matching(only({ query: 'ld-1003' }))).toEqual(['LD-1003']);
    expect(matching(only({ query: 'nashik' }))).toEqual(['LD-1003']);
    expect(matching(only({ query: 'ctwa-diwali' }))).toEqual(['LD-1001']);
    expect(matching(only({ query: 'brezza' }))).toEqual(['LD-1003']);
  });

  it('returns nothing for a query that matches no field', () => {
    expect(matching(only({ query: 'zzzz' }))).toEqual([]);
  });

  it('ignores a whitespace only query', () => {
    expect(matching(only({ query: '   ' }))).toHaveLength(4);
  });

  it('narrows to the intersection when several axes are set at once', () => {
    expect(matching(only({ owner: 'TM-1', state: 'warn' }))).toEqual(['LD-1004']);
    expect(matching(only({ owner: 'TM-1', state: 'breach' }))).toEqual([]);
    expect(matching(only({ owner: 'TM-1', query: 'pune' }))).toEqual(['LD-1001', 'LD-1004']);
  });

  it('does not mutate or reorder the input array', () => {
    const before = idsOf(LEADS);
    const result = filterLeads(LEADS, only({ state: 'breach' }), NOW, DEFAULT_THRESHOLDS);
    expect(idsOf(LEADS)).toEqual(before);
    expect(result).not.toBe(LEADS);
    expect(result).toHaveLength(1);
  });
});

describe('sortLeads', () => {
  const LEADS: Lead[] = [
    buildLead({
      id: 'LD-b',
      name: 'Bina Shah',
      createdMinutesAgo: 30,
      repliedAfterMinutes: null,
      amountInr: 300_000,
    }),
    buildLead({
      id: 'LD-a',
      name: 'Anil Kumar',
      createdMinutesAgo: 300,
      repliedAfterMinutes: 20,
      amountInr: 100_000,
    }),
    buildLead({
      id: 'LD-c',
      name: 'Chirag Patil',
      createdMinutesAgo: 90,
      repliedAfterMinutes: null,
      amountInr: 500_000,
    }),
  ];

  it('sorts created newest first', () => {
    expect(idsOf(sortLeads(LEADS, 'created', NOW, DEFAULT_THRESHOLDS))).toEqual([
      'LD-b',
      'LD-c',
      'LD-a',
    ]);
  });

  it('sorts amount highest first', () => {
    expect(idsOf(sortLeads(LEADS, 'amount', NOW, DEFAULT_THRESHOLDS))).toEqual([
      'LD-c',
      'LD-b',
      'LD-a',
    ]);
  });

  it('sorts name alphabetically', () => {
    expect(idsOf(sortLeads(LEADS, 'name', NOW, DEFAULT_THRESHOLDS))).toEqual([
      'LD-a',
      'LD-b',
      'LD-c',
    ]);
  });

  it('sorts wait with the urgency order', () => {
    expect(idsOf(sortLeads(LEADS, 'wait', NOW, DEFAULT_THRESHOLDS))).toEqual([
      'LD-c',
      'LD-b',
      'LD-a',
    ]);
  });

  it('leaves the input untouched for every sort field', () => {
    const fields: SortField[] = ['wait', 'created', 'amount', 'name'];
    for (const field of fields) {
      const sorted = sortLeads(LEADS, field, NOW, DEFAULT_THRESHOLDS);
      expect(idsOf(LEADS)).toEqual(['LD-b', 'LD-a', 'LD-c']);
      expect(sorted).not.toBe(LEADS);
      expect(sorted).toHaveLength(LEADS.length);
    }
  });
});

describe('summarise', () => {
  it('counts leads, replies and pending work', () => {
    const leads = [
      awaiting('LD-1', 5),
      awaiting('LD-2', 35),
      awaiting('LD-3', 75),
      replied('LD-4', 12),
      replied('LD-5', 40),
    ];
    expect(summarise(leads, NOW, DEFAULT_THRESHOLDS)).toMatchObject({
      leads: 5,
      replied: 2,
      pending: 3,
      breached: 1,
      warn: 1,
    });
  });

  it('reports a median of zero when nothing has been replied to', () => {
    const leads = [awaiting('LD-1', 5), awaiting('LD-2', 75)];
    expect(summarise(leads, NOW, DEFAULT_THRESHOLDS).medianFirstReplyMinutes).toBe(0);
  });

  it('averages the two middle values for an even reply count', () => {
    // A true median over an even sample is (21 + 30) / 2, not the lower value.
    const leads = [
      replied('LD-1', 40),
      replied('LD-2', 10),
      replied('LD-3', 30),
      replied('LD-4', 21),
    ];
    expect(summarise(leads, NOW, DEFAULT_THRESHOLDS).medianFirstReplyMinutes).toBe(25.5);
  });

  it('takes the middle value for an odd reply count', () => {
    const leads = [replied('LD-1', 90), replied('LD-2', 5), replied('LD-3', 15)];
    expect(summarise(leads, NOW, DEFAULT_THRESHOLDS).medianFirstReplyMinutes).toBe(15);
  });

  it('rounds the median to a single decimal place', () => {
    const leads = [replied('LD-1', 10.05), replied('LD-2', 11)];
    // The true median is 10.525 minutes; the payload rounds it to 10.5.
    expect(summarise(leads, NOW, DEFAULT_THRESHOLDS).medianFirstReplyMinutes).toBe(10.5);
  });

  it('adds up only the leads that are not closed', () => {
    const leads = [
      buildLead({ id: 'LD-1', createdMinutesAgo: 10, amountInr: 100_000, stage: 'new' }),
      buildLead({ id: 'LD-2', createdMinutesAgo: 10, amountInr: 250_000, stage: 'talks' }),
      buildLead({ id: 'LD-3', createdMinutesAgo: 10, amountInr: 900_000, stage: 'closed' }),
    ];
    expect(summarise(leads, NOW, DEFAULT_THRESHOLDS).pipelineInr).toBe(350_000);
  });

  it('scores a closed but unreplied lead as breached and as out of pipeline', () => {
    // Stage and reply are independent axes here: pipeline value follows the
    // stage, SLA health follows the first reply.
    const lead = buildLead({
      id: 'LD-1',
      createdMinutesAgo: 90,
      stage: 'closed',
      amountInr: 900_000,
    });
    expect(summarise([lead], NOW, DEFAULT_THRESHOLDS)).toMatchObject({
      leads: 1,
      replied: 0,
      pending: 1,
      breached: 1,
      warn: 0,
      pipelineInr: 0,
    });
  });

  it('returns all zeros for an empty lead list', () => {
    expect(summarise([], NOW, DEFAULT_THRESHOLDS)).toEqual({
      leads: 0,
      replied: 0,
      pending: 0,
      breached: 0,
      warn: 0,
      medianFirstReplyMinutes: 0,
      pipelineInr: 0,
    });
  });
});
