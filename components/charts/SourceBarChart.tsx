'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatPct } from '@/lib/format';
import type { SourceStat } from '@/types';

export interface SourceBarChartProps {
  data: SourceStat[];
}

/**
 * Token references only. The hex in each fallback slot is the value
 * `app/globals.css` already declares, so the SVG still paints if a token is
 * ever missing. No new colour is invented here.
 */
const PHOSPHOR = 'var(--c-phosphor, #39FF14)';
const CHROME = 'var(--c-chrome, #9CA3AF)';
const RULE = 'var(--c-rule, #1F1F1F)';
const MONO = 'var(--font-mono, ui-monospace), ui-monospace, monospace';

const CHART_HEIGHT = 210;
const BAR_SIZE = 14;
const ELLIPSIS = '\u2026';
const AD_PREFIX = /^CTWA-/i;
/** Longest hyphen-delimited fragment kept on the x axis before the ellipsis. */
const AXIS_LABEL_MAX = 10;

/**
 * `CTWA-Republic-Day-Sale` will not fit a ~60px band, so labels are clipped on
 * hyphen boundaries: drop the prefix, append whole segments while the result
 * fits AXIS_LABEL_MAX, then one ellipsis. Worst case is AXIS_LABEL_MAX + 1
 * characters, so a tick never overruns its band and never has to shrink below
 * 10px. The full name stays available in the tooltip.
 */
function shortSource(source: string): string {
  const stripped = source.replace(AD_PREFIX, '');
  if (stripped.length <= AXIS_LABEL_MAX + 1) return stripped;
  const segments = stripped.split('-');
  let kept = segments[0] ?? '';
  for (const segment of segments.slice(1)) {
    const next = `${kept}-${segment}`;
    if (next.length > AXIS_LABEL_MAX) break;
    kept = next;
  }
  return `${kept}${ELLIPSIS}`;
}

/** Text alternative for the figure; also the wording of the empty state. */
function summarise(rows: SourceStat[]): string {
  const top = rows[0];
  if (!top) return 'No source data available for this period.';
  const totalLeads = rows.reduce((sum, row) => sum + row.leads, 0);
  const totalClosed = rows.reduce((sum, row) => sum + row.closed, 0);
  const best = rows.reduce((champion, row) =>
    row.closeRatePct > champion.closeRatePct ? row : champion,
  );
  const overall = totalLeads > 0 ? (totalClosed / totalLeads) * 100 : 0;
  return [
    `Grouped bar chart of lead volume and closed leads across ${rows.length} ads.`,
    `${totalLeads} leads, ${totalClosed} closed, ${formatPct(overall)} overall close rate.`,
    `Highest volume ${top.source}: ${top.leads} leads, ${top.closed} closed (${formatPct(top.closeRatePct)}).`,
    `Best close rate ${best.source} at ${formatPct(best.closeRatePct)}.`,
  ].join(' ');
}

export function SourceBarChart({ data }: SourceBarChartProps): JSX.Element {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Sorted on a copy, so the caller's array is never mutated. Volume first,
  // close rate as the tiebreak.
  const rows = useMemo(
    () => data.slice().sort((a, b) => b.leads - a.leads || b.closeRatePct - a.closeRatePct),
    [data],
  );

  const summary = summarise(rows);

  if (rows.length === 0) {
    return (
      <figure className="m-0 w-full">
        <figcaption className="visually-hidden">{summary}</figcaption>
        <p className="m-0 p-3 text-[11px] uppercase tracking-[0.14em] text-chrome">
          <span className="text-phosphor">{'//'}</span> no source records in range
        </p>
      </figure>
    );
  }

  return (
    <figure className="m-0 w-full" aria-label="Lead volume and closed leads by ad">
      <figcaption className="visually-hidden">{summary}</figcaption>
      {mounted ? (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={rows} margin={{ top: 12, right: 8, bottom: 2, left: 0 }} barGap={2}>
            {/* Horizontal hairlines only: a vertical grid would cut through the
                bars, and --c-rule is deliberately below the contrast floor, so
                it stays non-text decoration. */}
            <CartesianGrid vertical={false} stroke={RULE} />
            <XAxis
              dataKey="source"
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              minTickGap={4}
              tick={{ fontSize: 10, fill: CHROME, fontFamily: MONO }}
              tickFormatter={(value: string) => shortSource(value)}
            />
            <YAxis
              type="number"
              allowDecimals={false}
              width={28}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: CHROME, fontFamily: MONO }}
              tickFormatter={(value: number) => String(Math.round(value))}
            />
            <Tooltip
              cursor={{ fill: 'var(--c-panel-2, #121212)' }}
              contentStyle={{
                backgroundColor: 'var(--c-panel-2, #121212)',
                border: '1px solid var(--c-rule, #1F1F1F)',
                borderRadius: 0,
                fontFamily: MONO,
                fontSize: 11,
                padding: '6px 8px',
              }}
              itemStyle={{ color: CHROME }}
              labelStyle={{ color: PHOSPHOR }}
              isAnimationActive={false}
            />
            <Legend
              verticalAlign="top"
              align="right"
              height={24}
              iconSize={8}
              wrapperStyle={{
                color: CHROME,
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            />
            {/*
             * Series colour. `closed` takes the full `--c-phosphor`: it is the
             * console's only "good news" signal and by far the brightest thing
             * on `--c-void`, so the eye lands on wins first and a high-close ad
             * reads as a bright block even in peripheral vision. `leads` takes
             * `--c-chrome` at 30% fill - a flat grey ghost that says "volume,
             * uninteresting" without a second saturated hue competing. Recharts
             * derives the legend swatch and legend text from `fill`, so both
             * stay full-opacity chrome and the legend copy clears the
             * readability bar. That split is what makes the interesting cases
             * pop: high-volume/low-close is a tall grey bar beside a stubby
             * green one, low-volume/high-close is a short grey bar beside a
             * tall green one.
             */}
            <Bar
              dataKey="leads"
              name="leads"
              fill={CHROME}
              fillOpacity={0.3}
              barSize={BAR_SIZE}
              maxBarSize={BAR_SIZE}
              radius={0}
              isAnimationActive={false}
            />
            <Bar
              dataKey="closed"
              name="closed"
              fill={PHOSPHOR}
              barSize={BAR_SIZE}
              maxBarSize={BAR_SIZE}
              radius={0}
              isAnimationActive={false}
            >
              {/* Close rate printed on every win bar, so the second measure is a
                  number on screen and never hover-only. */}
              <LabelList
                dataKey="closeRatePct"
                position="top"
                offset={6}
                fill={PHOSPHOR}
                fontSize={10}
                fontFamily={MONO}
                formatter={formatPct}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        /* Recharts needs real DOM measurements, so the server pass draws
           nothing. Zero height keeps the pre-hydration box empty. */
        <div className="h-0 w-full" aria-hidden />
      )}
    </figure>
  );
}
