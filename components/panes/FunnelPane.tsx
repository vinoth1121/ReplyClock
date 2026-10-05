'use client';

import { formatPct } from '@/lib/format';
import type { FunnelStage } from '@/types';
import { STAGE_LABEL, STAGE_ORDER } from '@/types';

export interface FunnelPaneProps {
  data: FunnelStage[];
}

/**
 * A conversion rate only means anything once the previous stage had volume, so
 * `null` is a real answer and gets a dash. Non-finite is treated the same way
 * rather than going through `formatPct`, which prints `0%` for NaN and would
 * quietly turn "not computed" into "zero percent".
 */
function conversionText(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '\u2014';
  return formatPct(pct);
}

/** Screen-reader sentence for the whole funnel; the digits and bars are visual. */
function summaryText(rows: FunnelStage[]): string {
  if (rows.length === 0) return 'Pipeline funnel has no stages for this period.';
  const parts = rows.map((row) => {
    const rate =
      row.conversionPct === null || !Number.isFinite(row.conversionPct)
        ? 'no conversion figure'
        : `${formatPct(row.conversionPct)} of the previous stage`;
    return `${row.label}: ${row.count} leads, ${rate}`;
  });
  return `Pipeline funnel across ${rows.length} stages. ${parts.join('. ')}.`;
}

export function FunnelPane({ data }: FunnelPaneProps): JSX.Element {
  // Iterate the canonical stage order rather than the payload order, and skip a
  // stage that is missing from the payload so a partial response cannot throw.
  const rows: FunnelStage[] = [];
  for (const stage of STAGE_ORDER) {
    const row = data.find((entry) => entry.stage === stage);
    if (row) rows.push(row);
  }

  const max = rows.reduce((peak, row) => (row.count > peak ? row.count : peak), 0);
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <section className="pane" aria-label="Pipeline funnel by stage">
      <span className="pane-corner pane-corner--tr" aria-hidden />
      <span className="pane-corner pane-corner--bl" aria-hidden />

      <div className="pane-head">
        <h2 className="pane-title">Funnel</h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-dim">
          {total} leads
        </span>
      </div>

      <div className="pane-body p-3">
        <p className="visually-hidden">{summaryText(rows)}</p>

        {rows.length === 0 ? (
          <p className="m-0 text-[11px] uppercase tracking-[0.14em] text-chrome">
            <span className="text-phosphor">{'//'}</span> no funnel stages in range
          </p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {rows.map((row) => {
              // One measure, one bar, plain divs - no chart library needed for
              // four numbers. The fill is clamped to the track so a full stage
              // cannot overflow, and the label plus count sit outside the track
              // so no amount of fill can run underneath the text.
              const width = max > 0 ? Math.min(100, (row.count / max) * 100) : 0;
              return (
                <li key={row.stage}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-chrome">
                      {row.label.length > 0 ? row.label : STAGE_LABEL[row.stage]}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-chrome">
                      {row.count}
                    </span>
                  </div>

                  <div className="mt-1 h-[6px] w-full border border-rule bg-panel2">
                    <div
                      className="h-full"
                      style={{ width: `${width}%`, backgroundColor: 'var(--c-phosphor)' }}
                    />
                  </div>

                  <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-dim">
                    {conversionText(row.conversionPct)} of previous stage
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
