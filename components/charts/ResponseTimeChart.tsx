'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DotProps } from 'recharts';

import { DEFAULT_SLA_MINUTES } from '@/lib/sla';
import type { ResponsePoint } from '@/types';

export interface ResponseTimeChartProps {
  data: ResponsePoint[];
  slaMinutes: number;
}

/**
 * Token references only. The hex in each fallback slot is the value
 * `app/globals.css` already declares, so the SVG still paints if a token is
 * ever missing. No new colour is invented here.
 */
const PHOSPHOR = 'var(--c-phosphor, #39FF14)';
const BREACH = 'var(--c-breach, #FF3B3B)';
const CHROME = 'var(--c-chrome, #9CA3AF)';
const RULE = 'var(--c-rule, #1F1F1F)';
const MONO = 'var(--font-mono, ui-monospace), ui-monospace, monospace';

const CHART_HEIGHT = 220;
/** Half-extent of the square active marker, in px. */
const ACTIVE_HALF = 3;
/** The domain ceiling is rounded up to a whole multiple of this, in minutes. */
const TICK_STEP = 15;

/** Minute tick label, e.g. `45m`. Guards against a non-finite scale value. */
function minutes(value: number): string {
  if (!Number.isFinite(value)) return '0m';
  return `${Math.round(value)}m`;
}

/** Any invalid SLA (NaN, non-finite, zero, negative) falls back to the default. */
function safeSla(slaMinutes: number): number {
  if (!Number.isFinite(slaMinutes) || slaMinutes <= 0) return DEFAULT_SLA_MINUTES;
  return Math.round(slaMinutes);
}

/**
 * Square active marker. Recharts supplies `cx`/`cy`, so the square is placed
 * around the point. Typed with Recharts' own `DotProps` so the callback stays
 * assignable to `activeDot` without a cast.
 */
function squareActiveDot(dot: DotProps): JSX.Element {
  return (
    <rect
      x={(dot.cx ?? 0) - ACTIVE_HALF}
      y={(dot.cy ?? 0) - ACTIVE_HALF}
      width={ACTIVE_HALF * 2}
      height={ACTIVE_HALF * 2}
      fill={PHOSPHOR}
    />
  );
}

/** Text alternative for the figure; also the wording of the empty state. */
function summarise(points: ResponsePoint[], sla: number): string {
  const first = points.at(0);
  const latest = points.at(-1);
  if (!first || !latest) return 'No response-time history for this period.';
  const inside = points.filter(
    (point) =>
      Number.isFinite(point.medianFirstReplyMinutes) && point.medianFirstReplyMinutes <= sla,
  );
  const latestMinutes = latest.medianFirstReplyMinutes;
  const trend = latestMinutes <= first.medianFirstReplyMinutes ? 'improving' : 'worsening';
  return [
    `Stepped line chart of median first-reply time across ${points.length} days against a ${sla}-minute SLA.`,
    `${inside.length} of ${points.length} days were inside target.`,
    `Latest day ${latest.day}: ${Math.round(latestMinutes)}m, ${latestMinutes <= sla ? 'inside' : 'outside'} target.`,
    `Trending ${trend} from ${Math.round(first.medianFirstReplyMinutes)}m at the start of the window.`,
  ].join(' ');
}

export function ResponseTimeChart({ data, slaMinutes }: ResponseTimeChartProps): JSX.Element {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const sla = safeSla(slaMinutes);

  // Headroom above the slowest day and above the SLA line, so neither is ever
  // drawn flush against the top of the plot.
  const ceiling = useMemo(() => {
    let peak = 0;
    for (const point of data) {
      if (Number.isFinite(point.medianFirstReplyMinutes)) {
        peak = Math.max(peak, point.medianFirstReplyMinutes);
      }
    }
    const padded = Math.max(peak, sla) * 1.1;
    return Math.max(TICK_STEP, Math.ceil(padded / TICK_STEP) * TICK_STEP);
  }, [data, sla]);

  // 14 days of `12 Oct` labels collide in a half-width pane, so show roughly
  // every other one; 14 -> step 1.
  const labelStep = data.length > 8 ? Math.ceil(data.length / 8) - 1 : 0;

  const summary = summarise(data, sla);

  if (data.length === 0) {
    return (
      <figure className="m-0 w-full">
        <figcaption className="visually-hidden">{summary}</figcaption>
        <p className="m-0 p-3 text-[11px] uppercase tracking-[0.14em] text-chrome">
          <span className="text-phosphor">{'//'}</span> no response history in range
        </p>
      </figure>
    );
  }

  return (
    <figure className="m-0 w-full" aria-label="Median first-reply time by day against the SLA">
      <figcaption className="visually-hidden">{summary}</figcaption>
      {mounted ? (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={data} margin={{ top: 10, right: 14, bottom: 2, left: 0 }}>
            {/* Horizontal hairlines only; --c-rule is decorative by design. */}
            <CartesianGrid vertical={false} stroke={RULE} />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              interval={labelStep}
              tick={{ fontSize: 10, fill: CHROME, fontFamily: MONO }}
            />
            <YAxis
              type="number"
              domain={[0, ceiling]}
              allowDecimals={false}
              width={38}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: CHROME, fontFamily: MONO }}
              tickFormatter={(value: number) => minutes(value)}
            />
            {/* Everything past the SLA is the breach region. Opacity stays at
                6%: a stain behind the line, not a dashboard heat band. */}
            <ReferenceArea y1={sla} y2={ceiling} fill={BREACH} fillOpacity={0.06} />
            {/* The dashed line carries its own visible label, so breach is never
                signalled by colour alone. */}
            <ReferenceLine
              y={sla}
              stroke={BREACH}
              strokeWidth={1}
              strokeDasharray="4 3"
              label={{
                value: `sla ${sla}m`,
                position: 'insideTopRight',
                fill: BREACH,
                fontSize: 10,
                fontFamily: MONO,
              }}
            />
            <Line
              dataKey="medianFirstReplyMinutes"
              name="median first reply"
              type="stepAfter"
              stroke={PHOSPHOR}
              strokeWidth={2}
              dot={false}
              activeDot={squareActiveDot}
              connectNulls
              isAnimationActive={false}
            />
            <Tooltip
              cursor={{ stroke: RULE, strokeWidth: 1 }}
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
              formatter={(value: number) =>
                `${minutes(value)} ${value <= sla ? 'inside sla' : 'BREACH'}`
              }
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        /* Recharts needs real DOM measurements, so the server pass draws
           nothing. Zero height keeps the pre-hydration box empty. */
        <div className="h-0 w-full" aria-hidden />
      )}
    </figure>
  );
}
