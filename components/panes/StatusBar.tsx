'use client';

import { formatClock, formatDurationShort } from '@/lib/format';
import type { StatsPayload, TeamMember } from '@/types';

export interface StatusBarProps {
  now: number;
  team: TeamMember[];
  totals: StatsPayload['totals'];
  slaMinutes: number;
  scanlines: boolean;
  onToggleScanlines: () => void;
}

/**
 * Median first reply arrives in minutes; the wait formatters want
 * milliseconds. A missing or zero median has nothing meaningful to say, so it
 * renders as a dash rather than a misleading `0s`.
 */
function medianReplyText(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '\u2014';
  return formatDurationShort(minutes * 60_000);
}

/** A counter the parent hands over is assumed to be a real number; a bad one is zero. */
function safeCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Console header strip.
 *
 * `now` is a prop rather than an internal interval: the parent already ticks
 * one clock for the whole console and the queue wait timers read from it, so a
 * second interval here would only drift against it. For the same reason this
 * pane has no aria-live region - the parent owns breach announcements, and a
 * clock re-announcing every second would drown them out.
 */
export function StatusBar({
  now,
  team,
  totals,
  slaMinutes,
  scanlines,
  onToggleScanlines,
}: StatusBarProps): JSX.Element {
  const online = team.filter((member) => member.online).length;
  const pending = safeCount(totals.pending);
  const breached = safeCount(totals.breached);
  const warned = safeCount(totals.warn);

  return (
    // Both classes are load-bearing: `status-bar` is the print-hide hook in
    // globals.css, `topbar` is the console shell's own layout hook.
    <header className="status-bar topbar">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.28em] text-phosphor">
          ReplyClock
        </span>

        {/* Wall clock. Plain text, not a live region: it changes every tick and
            announcing it would be noise. */}
        <span className="font-mono text-[11px] tabular-nums text-chrome">{formatClock(now)}</span>

        <span className="text-[11px] uppercase tracking-[0.14em] text-dim">
          ops{' '}
          <span className="text-chrome">
            {online}/{team.length}
          </span>{' '}
          online
        </span>

        {/* SLA health. Green/amber/red means the same thing it means everywhere
            else in this console: ok / warn / breach. `pending` stays chrome
            because "how many are still open" is a volume, not a verdict. */}
        <span className="text-[11px] uppercase tracking-[0.14em] text-dim">
          sla <span className="text-chrome">{pending}</span> pending{' '}
          <span className="text-breach">{breached} breach</span>{' '}
          <span className="text-amber">{warned} warn</span>
        </span>

        <span className="text-[11px] uppercase tracking-[0.14em] text-dim">
          target <span className="text-phosphor">{safeCount(slaMinutes)}m</span>
        </span>

        <span className="text-[11px] uppercase tracking-[0.14em] text-dim">
          median first reply{' '}
          <span className="text-chrome">{medianReplyText(totals.medianFirstReplyMinutes)}</span>
        </span>

        <button
          type="button"
          className="btn btn--ghost ml-auto"
          aria-pressed={scanlines}
          onClick={onToggleScanlines}
        >
          <span aria-hidden>{scanlines ? '[x]' : '[ ]'}</span>
          scanlines
        </button>
      </div>
    </header>
  );
}
