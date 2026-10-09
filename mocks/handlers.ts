import { http, HttpResponse } from 'msw';
import { generateSeed, generateResponseHistory } from '@/lib/seed';
import { DEFAULT_SLA_MINUTES, summarise, thresholdsFor } from '@/lib/sla';
import { STAGE_ORDER, STAGE_LABEL } from '@/types';
import type { LeadsPayload, StatsPayload } from '@/types';

export const handlers = [
  http.get('/api/leads', () => {
    const now = Date.now();
    const bundle = generateSeed(now);
    return HttpResponse.json<LeadsPayload>({
      leads: bundle.leads,
      team: bundle.team,
      sources: bundle.sources,
      generatedAt: bundle.generatedAt,
      now: new Date(now).toISOString(),
    });
  }),
  http.get('/api/stats', ({ request }) => {
    const url = new URL(request.url);
    const raw = url.searchParams.get('sla');
    const slaMinutes = (() => {
      if (raw === null || raw.trim() === '') return DEFAULT_SLA_MINUTES;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return DEFAULT_SLA_MINUTES;
      return Math.min(1440, Math.max(2, Math.round(parsed)));
    })();
    const now = Date.now();
    const bundle = generateSeed(now);
    const thresholds = thresholdsFor(slaMinutes);
    const counts = new Map();
    for (const lead of bundle.leads) {
      counts.set(lead.stage, (counts.get(lead.stage) ?? 0) + 1);
    }
    const funnel = STAGE_ORDER.map((stage, index) => {
      const count = counts.get(stage) ?? 0;
      const previous = STAGE_ORDER[index - 1];
      const prevCount = previous === undefined ? null : (counts.get(previous) ?? 0);
      const conversionPct =
        prevCount === null || prevCount === 0 ? null : Math.round((count / prevCount) * 1000) / 10;
      return { stage, label: STAGE_LABEL[stage], count, prevCount, conversionPct };
    });
    const sources = bundle.sources
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
      .sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source));
    return HttpResponse.json<StatsPayload>({
      now: new Date(now).toISOString(),
      slaMinutes,
      totals: summarise(bundle.leads, now, thresholds),
      funnel,
      sources,
      responseSeries: generateResponseHistory(now),
    });
  }),
];