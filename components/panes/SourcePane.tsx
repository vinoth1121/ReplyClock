'use client';

import { SourceBarChart } from '@/components/charts/SourceBarChart';
import type { SourceStat } from '@/types';

export interface SourcePaneProps {
  data: SourceStat[];
}

/**
 * Thin wrapper around {@link SourceBarChart}. The chart already renders its own
 * <figcaption> text alternative and owns its own colours, so nothing here
 * restyles it. This pane only supplies the frame and one line telling the
 * operator which comparison to make, which is the judgement the chart cannot
 * make for them.
 */
export function SourcePane({ data }: SourcePaneProps): JSX.Element {
  return (
    <section className="pane" aria-label="Lead volume and wins by source ad">
      <span className="pane-corner pane-corner--tr" aria-hidden />
      <span className="pane-corner pane-corner--bl" aria-hidden />

      <div className="pane-head">
        <h2 className="pane-title">Sources</h2>
        <span className="text-[11px] uppercase tracking-[0.14em] text-dim">{data.length} ads</span>
      </div>

      <div className="pane-body">
        <SourceBarChart data={data} />
      </div>

      <p className="m-0 border-t border-rule px-3 py-2 text-[11px] leading-relaxed text-chrome">
        Read volume against wins: a tall grey bar beside a stubby green one is an ad buying
        conversations the team is not closing.
      </p>
    </section>
  );
}
