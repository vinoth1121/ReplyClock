'use client';

import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { formatWait, truncate } from '@/lib/format';
import { isAwaitingReply, minutesUntilBreach, slaStateFor, waitMsFor } from '@/lib/sla';
import type { SlaThresholds } from '@/lib/sla';
import type { Lead, LeadFilter, SlaState, SortField, TeamMember } from '@/types';
import { STAGE_LABEL, STAGE_ORDER } from '@/types';

export interface LeadQueueProps {
  /** Already filtered + sorted by the parent; rendered in exactly this order. */
  leads: Lead[];
  totalCount: number;
  team: TeamMember[];
  thresholds: SlaThresholds;
  slaMinutes: number;
  selectedId: string | null;
  now: number;
  sort: SortField;
  filter: LeadFilter;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onReply: (id: string) => void;
  onCycleStage: (id: string) => void;
}

/** WAIT text colour per SLA state. Only these three carry meaning. */
const SLA_TEXT: Record<SlaState, string> = {
  ok: 'text-phosphor',
  warn: 'text-amber',
  breach: 'text-breach',
};

/**
 * Non-colour breach signal: the literal word in the WAIT cell. A row that is
 * red/amber also prints BREACH or WARN, so the state survives greyscale,
 * colour-blindness, and any theme that loses saturation. The row aria-label
 * repeats it for screen readers.
 */
function markerText(state: SlaState): string | null {
  if (state === 'breach') return 'BREACH';
  if (state === 'warn') return 'WARN';
  return null;
}

/** Keys that jump to the stage cycle when the queue itself has focus. */
function isFormControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'SELECT' || tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA';
}

/** Human echo of the active filter, so the pane explains what it is showing. */
function filterSummary(filter: LeadFilter): string {
  const parts: string[] = [];
  if (filter.stage !== 'all') parts.push(filter.stage);
  if (filter.owner !== 'all') parts.push(filter.owner === 'unassigned' ? 'unassigned' : 'owner');
  if (filter.state !== 'all') parts.push(`sla ${filter.state}`);
  if (filter.source !== 'all') parts.push(filter.source);
  const query = filter.query.trim();
  if (query.length > 0) parts.push(`"${query}"`);
  return parts.length === 0 ? 'no filter' : parts.join(' / ');
}

/** Owner name, or a truthful fallback when the id points at nobody on the team. */
function ownerLabel(lead: Lead, team: TeamMember[]): string {
  if (lead.ownerId === null) return 'unassigned';
  const match = team.find((member) => member.id === lead.ownerId);
  return match ? match.name : lead.ownerId;
}

export function LeadQueue({
  leads,
  totalCount,
  team,
  thresholds,
  slaMinutes,
  selectedId,
  now,
  sort,
  filter,
  onSelect,
  onOpen,
  onReply,
  onCycleStage,
}: LeadQueueProps): JSX.Element {
  // Roving-tabindex store: lead id -> the row element, so a keyboard move can
  // hand DOM focus to the row the parent just selected.
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const filtered = leads.length !== totalCount;

  function focusRow(id: string): void {
    const row = rowRefs.current.get(id);
    if (row) row.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableSectionElement>): void {
    if (leads.length === 0) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // A focused <select> or button owns its own arrow/letter keys; hijacking
    // them here would fight the control the user is actually operating.
    if (isFormControl(event.target)) return;

    const first = leads[0];
    if (!first) return;
    const current = leads.findIndex((lead) => lead.id === selectedId);
    let nextId: string | null = null;

    switch (event.key) {
      case 'ArrowDown':
      case 'j':
        nextId = (current >= 0 ? leads[current + 1] : first)?.id ?? null;
        break;
      case 'ArrowUp':
      case 'k':
        nextId = (current >= 1 ? leads[current - 1] : leads[leads.length - 1])?.id ?? null;
        break;
      case 'Home':
        nextId = first.id;
        break;
      case 'End':
        nextId = leads[leads.length - 1]?.id ?? null;
        break;
      case 'Enter':
        if (selectedId) onOpen(selectedId);
        break;
      case 's':
        // Nothing selected yet: take the first row rather than mutating a lead
        // the user has not looked at.
        if (!selectedId) nextId = first.id;
        else onCycleStage(selectedId);
        break;
      default:
        return;
    }

    // Stop propagation on every key we consume: the shell owns a global j/k
    // handler, and letting these bubble would move the selection twice - once
    // here and once in the parent - for a single keystroke.
    event.preventDefault();
    event.stopPropagation();

    if (nextId) {
      onSelect(nextId);
      focusRow(nextId);
    }
  }

  return (
    <section className="lead-queue pane" aria-label="Lead queue">
      <span className="pane-corner pane-corner--tr" aria-hidden />
      <span className="pane-corner pane-corner--bl" aria-hidden />

      <div className="pane-head">
        <h2 className="pane-title">Lead queue</h2>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* Only announced when the view is actually a subset of the data. */}
          <span
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-chrome"
            aria-live="polite"
          >
            {filtered ? `showing ${leads.length} of ${totalCount}` : `${totalCount} leads`}
          </span>
          <span className="text-[11px] uppercase tracking-[0.14em] text-dim">
            sort {sort} / {filterSummary(filter)} / sla {slaMinutes}m
          </span>
        </div>
      </div>

      <div className="pane-body">
        {leads.length === 0 ? (
          <div className="p-4">
            <p className="m-0 text-[11px] uppercase tracking-[0.14em] text-chrome">
              <span className="text-phosphor">{'//'}</span> no leads match the current filter
            </p>
            <p className="m-0 mt-1 text-[11px] uppercase tracking-[0.14em] text-chrome">
              press <span className="text-phosphor">clear</span> to reset the filter
            </p>
          </div>
        ) : (
          <>
            {/* The queue's table is the only horizontal scroll container in the
                console; the panes around it all wrap instead. */}
            <div className="overflow-x-auto">
              <table
                className="w-full border-collapse text-left font-mono text-[12px]"
                style={{ borderCollapse: 'separate', borderSpacing: 0 }}
              >
                <caption className="visually-hidden">
                  Lead queue. Arrow keys or j and k move between leads, Enter opens the selected
                  lead, s cycles its stage. Ordered by {sort}, filter {filterSummary(filter)}.
                </caption>
                <thead>
                  <tr className="bg-panel2">
                    {['ID', 'Name', 'Source ad', 'Stage', 'Owner', 'Wait'].map((heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="border-b border-rule px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-dim"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody onKeyDown={handleKeyDown}>
                  {leads.map((lead) => {
                    const selected = lead.id === selectedId;
                    const wait = waitMsFor(lead, now);
                    const awaiting = isAwaitingReply(lead);
                    const state = slaStateFor(lead, now, thresholds);
                    const marker = markerText(state);
                    const over = awaiting ? -minutesUntilBreach(lead, now, thresholds) : 0;
                    const owner = ownerLabel(lead, team);
                    const stageSelectId = `stage-${lead.id}`;
                    const stageWord = awaiting ? state : 'replied';

                    const rowLabel = awaiting
                      ? `${lead.id}, ${lead.name}, ${STAGE_LABEL[lead.stage]}, ${owner}, waiting ${formatWait(wait)}, SLA ${stageWord}`
                      : `${lead.id}, ${lead.name}, ${STAGE_LABEL[lead.stage]}, ${owner}, first reply sent after ${formatWait(wait)}, SLA ok`;

                    return (
                      <tr
                        key={lead.id}
                        ref={(element) => {
                          const map = rowRefs.current;
                          if (element) map.set(lead.id, element);
                          else map.delete(lead.id);
                        }}
                        // Roving tabindex: exactly one row is in the tab order,
                        // the selected one, so Tab enters the queue and Arrows
                        // do the travelling.
                        tabIndex={selected || (!selectedId && leads[0]?.id === lead.id) ? 0 : -1}
                        aria-label={rowLabel}
                        onClick={() => onSelect(lead.id)}
                        onDoubleClick={() => onOpen(lead.id)}
                        className="cursor-pointer border-b border-rule align-middle hover:bg-panel2"
                      >
                        <td
                          className="whitespace-nowrap px-3 py-2"
                          style={
                            selected
                              ? {
                                  borderLeft: '2px solid var(--c-phosphor)',
                                  backgroundColor: 'var(--c-panel-2)',
                                }
                              : { borderLeft: '2px solid transparent' }
                          }
                        >
                          <span className="text-chrome">{lead.id}</span>
                        </td>

                        <td className="whitespace-nowrap px-3 py-2">
                          <span className="text-chrome">{lead.name}</span>{' '}
                          {/* Visible affordance so Enter / double-click have a
                              mouse equivalent that announces itself. */}
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              onReply(lead.id);
                            }}
                          >
                            reply
                          </button>{' '}
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpen(lead.id);
                            }}
                          >
                            open
                          </button>
                        </td>

                        <td className="px-3 py-2" title={lead.source}>
                          <span className="text-chrome">{truncate(lead.source, 16)}</span>
                        </td>

                        <td className="px-3 py-2">
                          <label className="visually-hidden" htmlFor={stageSelectId}>
                            Stage for {lead.name}
                          </label>
                          <select
                            id={stageSelectId}
                            className="field"
                            value={lead.stage}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => onCycleStage(lead.id)}
                          >
                            {STAGE_ORDER.map((stage) => (
                              <option key={stage} value={stage}>
                                {STAGE_LABEL[stage]}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="whitespace-nowrap px-3 py-2">
                          {/* An unowned lead is a routing failure the product
                              exists to catch, so it is the one non-SLA thing
                              that earns amber. Owner names are never coloured. */}
                          <span className={lead.ownerId === null ? 'text-amber' : 'text-chrome'}>
                            {owner}
                          </span>
                        </td>

                        <td className="whitespace-nowrap px-3 py-2">
                          {awaiting ? (
                            <>
                              {/* Live: recomputed from the `now` prop on every
                                  parent tick, so no timer lives in here. */}
                              <span className={SLA_TEXT[state]}>{formatWait(wait)}</span>{' '}
                              {marker ? <span className={SLA_TEXT[state]}>{marker}</span> : null}
                              {over > 0 ? (
                                <>
                                  {' '}
                                  <span className="text-breach">+{Math.round(over)}m over</span>
                                </>
                              ) : null}
                            </>
                          ) : (
                            /* Timer frozen: the number stops mattering the
                               moment the first reply goes out, so the cell says
                               so instead of implying a live countdown. */
                            <span className="text-chrome">replied</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="m-0 border-t border-rule px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-chrome">
              arrows / j k move &middot; enter opens &middot; s cycles stage &middot; click a row to
              select
            </p>
          </>
        )}
      </div>
    </section>
  );
}
