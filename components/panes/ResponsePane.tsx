'use client';

import { ResponseTimeChart } from '@/components/charts/ResponseTimeChart';
import { formatDurationShort } from '@/lib/format';
import type { ResponsePoint } from '@/types';

export interface ResponsePaneProps {
  data: ResponsePoint[];
  slaMinutes: number;
}

/**
 * Change below this many minutes is noise, not a trend: day-to-day medians move
 * by a minute or two on their own, and calling that "improving" would be a
 * lie an operator acts on.
 */
const FLAT_BAND_MINUTES = 2;

const MS_PER_MINUTE = 60_000;

/** Direction of travel, chrome text only. Colour is reserved for SLA signal. */
function readout(data: ResponsePoint[]): string {
  const first = data.at(0);
  const latest = data.at(-1);
  if (!first || !latest) {
    return '// no response history in range';
  }

  const from = first.medianFirstReplyMinutes;
  const to = latest.medianFirstReplyMinutes;
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return '// response history is incomplete for this window';
  }

  // A one-point series has no direction to report; saying "flat" would imply a
  // comparison that was never made.
  if (data.length < 2) {
    return `// single reading: median first reply ${formatDurationShort(to * MS_PER_MINUTE)}`;
  }

  const delta = to - from;
  const span = data.length;
  const window = `${first.day} to ${latest.day}, ${span} days`;
  const fromText = formatDurationShort(from * MS_PER_MINUTE);
  const toText = formatDurationShort(to * MS_PER_MINUTE);

  if (Math.abs(delta) < FLAT_BAND_MINUTES) {
    return `// flat: median first reply held at ${toText} over ${window}`;
  }
  if (delta < 0) {
    return `// improving: median first reply fell ${fromText} to ${toText} over ${window}`;
  }
  return `// worsening: median first reply rose ${fromText} to ${toText} over ${window}`;
}

export function ResponsePane({ data, slaMinutes }: ResponsePaneProps): JSX.Element {
  return (
    <section className="pane" aria-label="Median first-reply time by day">
      <span className="pane-corner pane-corner--tr" aria-hidden />
      <span className="pane-corner pane-corner--bl" aria-hidden />

      <div className="pane-head">
        <h2 className="pane-title">Response time</h2>
        <span className="text-[11px] uppercase tracking-[0.14em] text-dim">sla {slaMinutes}m</span>
      </div>

      <div className="pane-body">
        <ResponseTimeChart data={data} slaMinutes={slaMinutes} />
      </div>

      {/* Plain-words direction of travel. The chart's own caption already
          summarises the figure, so this adds the comparison rather than
          repeating it. */}
      <p className="m-0 border-t border-rule px-3 py-2 text-[11px] leading-relaxed text-chrome">
        {readout(data)}
      </p>
    </section>
  );
}
