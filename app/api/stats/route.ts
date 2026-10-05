/**
 * ReplyClock aggregate statistics.
 *
 * Read-only: the console mutates its own copy client-side in a reducer, so this
 * handler only ever serves a freshly derived rollup. There is no database and
 * nothing is written.
 */

import { NextResponse } from 'next/server';

import type { FunnelStage, SourceStat, Stage, StatsPayload } from '@/types';
import { STAGE_LABEL, STAGE_ORDER } from '@/types';
import { generateResponseHistory, generateSeed } from '@/lib/seed';
import { DEFAULT_SLA_MINUTES, summarise, thresholdsFor } from '@/lib/sla';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Lower bound for the SLA override: anything shorter is not actionable. */
const MIN_SLA_MINUTES = 2;

/** Upper bound for the SLA override: one day. */
const MAX_SLA_MINUTES = 1440;

/**
 * Resolves the `?sla=` query override to a usable integer minute count.
 *
 * A missing, blank or non-numeric value falls back to `DEFAULT_SLA_MINUTES`, and
 * anything finite is rounded then clamped into `[2, 1440]`. This never throws:
 * a malformed query string such as `?sla=abc` still yields 200 with the default
 * SLA, because a hard failure on a demo endpoint would blank the whole console
 * rather than falling back to the value the user is already seeing.
 */
function resolveSlaMinutes(raw: string | null): number {
  if (raw === null || raw.trim() === '') return DEFAULT_SLA_MINUTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SLA_MINUTES;
  return Math.min(MAX_SLA_MINUTES, Math.max(MIN_SLA_MINUTES, Math.round(parsed)));
}

/**
 * Returns headline totals, the pipeline funnel, per-ad rollups and the
 * first-response history, all recomputed per hit.
 *
 * Caching is disabled deliberately. The pending and breached counts are derived
 * from wait timers that are still running, and the client re-anchors its
 * countdowns to the `now` this route reports. A cached response would freeze the
 * SLA state at the moment it was cached, so `force-dynamic` / `revalidate = 0`
 * are paired with explicit no-store headers rather than relying on either alone.
 *
 * No authentication. The payload is entirely synthetic - fixed-seed leads,
 * stage counts and daily medians - so there is no real lead, no real WhatsApp
 * number and no credential to protect.
 *
 * Only the query string is defensive. Errors from the dataset generator are
 * intentionally *not* caught: a 200-shaped fallback would render an empty
 * console that looks healthy, so a real 500 is the honest signal instead.
 */
export async function GET(request: Request): Promise<NextResponse<StatsPayload>> {
  const raw = new URL(request.url).searchParams.get('sla');
  const slaMinutes = resolveSlaMinutes(raw);

  const now = Date.now();
  const bundle = generateSeed(now);
  const thresholds = thresholdsFor(slaMinutes);

  const counts = new Map<Stage, number>();
  for (const lead of bundle.leads) {
    counts.set(lead.stage, (counts.get(lead.stage) ?? 0) + 1);
  }

  const funnel: FunnelStage[] = STAGE_ORDER.map((stage, index) => {
    const count = counts.get(stage) ?? 0;
    const previous = STAGE_ORDER[index - 1];
    const prevCount = previous === undefined ? null : (counts.get(previous) ?? 0);
    // `null` rather than `0` for a missing denominator: the first stage has no
    // previous stage at all, and a stage nothing feeds has no conversion rate to
    // report. Zero would read as "nobody converted" and `Infinity` would be
    // meaningless in JSON, so both non-rates are `null`.
    const conversionPct =
      prevCount === null || prevCount === 0 ? null : Math.round((count / prevCount) * 1000) / 10;
    return { stage, label: STAGE_LABEL[stage], count, prevCount, conversionPct };
  });

  const sources: SourceStat[] = bundle.sources
    .map((source) => {
      let leads = 0;
      let closed = 0;
      for (const lead of bundle.leads) {
        if (lead.source !== source) continue;
        leads += 1;
        if (lead.stage === 'closed') closed += 1;
      }
      return {
        source,
        leads,
        closed,
        closeRatePct: leads === 0 ? 0 : Math.round((closed / leads) * 1000) / 10,
      };
    })
    // Volume descending, then name ascending, so the row order is stable across
    // requests and equal-volume ads keep a fixed position.
    .sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source));

  return NextResponse.json<StatsPayload>(
    {
      now: new Date(now).toISOString(),
      slaMinutes,
      totals: summarise(bundle.leads, now, thresholds),
      funnel,
      sources,
      responseSeries: generateResponseHistory(now),
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    },
  );
}
