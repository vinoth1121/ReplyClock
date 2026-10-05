/**
 * ReplyClock lead detail drawer.
 *
 * A right-anchored slide-over that owns its own scroll container. The parent
 * owns open state and every mutation: this component renders, validates and
 * calls back. It never fetches, never reads a clock and never mutates a lead.
 *
 * Layout contract: the panel is `fixed` + `w-full max-w-[26rem]`, so it can
 * never be wider than the viewport, its scroll container carries
 * `overflow-x-hidden`, and every text-bearing flex child carries `min-w-0`.
 * That is what stops a long city name or a long WhatsApp message from forcing
 * horizontal page scroll.
 *
 * NOTE ON DUPLICATION: the `useModalDialog` focus trap below is a plain
 * ~45-line hook, deliberately repeated in each dialog file rather than hoisted
 * into a shared module - this file is one of five files this work owns and a
 * sixth (a hooks barrel) is out of scope.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { formatDateTime, formatINR, formatPhone, formatWait } from '@/lib/format';
import { isAwaitingReply, minutesUntilBreach, slaStateFor, waitMsFor } from '@/lib/sla';
import type { SlaThresholds } from '@/lib/sla';
import { STAGE_LABEL, STAGE_ORDER } from '@/types';
import type { Lead, SlaState, Stage, TeamMember } from '@/types';

export interface LeadDrawerProps {
  lead: Lead | null;
  team: TeamMember[];
  thresholds: SlaThresholds;
  slaMinutes: number;
  now: number;
  onClose: () => void;
  onReply: (leadId: string) => void;
  onStageChange: (leadId: string, stage: Stage) => void;
  onOwnerChange: (leadId: string, ownerId: string | null) => void;
  onAddNote: (leadId: string, text: string) => void;
}

/* ---------------------------------------------------------------------------
 * Focus trap
 * ------------------------------------------------------------------------ */

/** Everything that can hold focus inside a dialog, in DOM order. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Visible, focusable descendants of `root`, in document order. */
function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) => node.getClientRects().length > 0,
  );
}

/**
 * Real modal behaviour for a non-native dialog: move focus in on open, hold
 * Tab / Shift+Tab inside, send Escape to `onClose`, and put focus back where the
 * user left it on close.
 *
 * `onClose` is held in a ref so an inline arrow function from the parent cannot
 * re-run this effect on every render - re-running it would yank focus back into
 * the panel and re-fire the restore, which reads to a keyboard user as the
 * panel fighting them.
 */
function useModalDialog(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement>,
): void {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previous = document.activeElement;
    const initial =
      panel.querySelector<HTMLElement>('[data-autofocus]') ?? focusableWithin(panel)[0] ?? panel;
    initial.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusableWithin(panel);
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, panelRef]);
}

/* ---------------------------------------------------------------------------
 * Presentation maps - colour is a signal here, never the only signal
 * ------------------------------------------------------------------------ */

/** Border + text colour per SLA state. */
const SLA_TONE: Record<SlaState, string> = {
  ok: 'text-phosphor border-phosphor',
  warn: 'text-amber border-amber',
  breach: 'text-breach border-breach',
};

/**
 * The non-colour state marker. `[ok]` / `[warn]` / `[breach]` is printed as text
 * inside the strip, so the state survives greyscale, colour-blindness and a
 * monochrome print - the colour is reinforcement, not the encoding.
 */
const SLA_WORD: Record<SlaState, string> = {
  ok: 'ok',
  warn: 'warn',
  breach: 'breach',
};

/** Select sentinel for "no owner", mapped to `null` before the parent call. */
const UNASSIGNED = 'unassigned';

/** Narrows a `<select>` value back to a `Stage`, or `null` if it is not one. */
function asStage(value: string): Stage | null {
  return STAGE_ORDER.find((stage) => stage === value) ?? null;
}

/** Inline note asking the operator to say something before saving. */
const NOTE_REQUIRED = 'Write the note first - a note needs at least one character.';

/** Title element id, stable so `aria-labelledby` survives a lead switch. */
const TITLE_ID = 'lead-drawer-title';

/**
 * The drawer returns `null` when `lead` is `null`, so its return type is
 * `JSX.Element | null` - a component that can render nothing cannot be typed
 * `JSX.Element`. The parent still owns open state; this only controls markup.
 */
export function LeadDrawer({
  lead,
  team,
  thresholds,
  slaMinutes,
  now,
  onClose,
  onReply,
  onStageChange,
  onOwnerChange,
  onAddNote,
}: LeadDrawerProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalDialog(lead !== null, onClose, panelRef);

  const [noteText, setNoteText] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  // Switching leads must not carry the previous lead's half-typed note across.
  const leadId = lead?.id ?? null;
  useEffect(() => {
    setNoteText('');
    setNoteError(null);
  }, [leadId]);

  if (lead === null) return null;

  const waitMs = waitMsFor(lead, now);
  const slaState = slaStateFor(lead, now, thresholds);
  const overdue = minutesUntilBreach(lead, now, thresholds);
  const awaiting = isAwaitingReply(lead);

  // Ascending: a stage history reads oldest -> newest, like a shell history.
  const timeline = lead.timeline
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  // `leadId` is passed in because TypeScript does not keep the null narrowing
  // of a destructured parameter inside a function body.
  function submitNote(leadId: string): void {
    const trimmed = noteText.trim();
    if (trimmed.length === 0) {
      setNoteError(NOTE_REQUIRED);
      return;
    }
    onAddNote(leadId, trimmed);
    setNoteText('');
    setNoteError(null);
  }

  return (
    <div className="no-print fixed inset-0 z-40 flex justify-end">
      {/*
        Scrim. A plain sibling layer, not a scroll-locking modal: the page keeps
        its own scroll behaviour, and only the panel's own container scrolls.
      */}
      <div className="absolute inset-0 bg-void/80" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[26rem] flex-col overflow-hidden border-l border-rule bg-panel"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          {/* 1 - header ------------------------------------------------------ */}
          <header className="border-b border-rule p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 id={TITLE_ID} className="m-0 text-base text-phosphor">
                  {lead.name}
                </h2>
                <p className="m-0 mt-1 break-words text-[11px] text-chrome">
                  {lead.id} &middot; {lead.city}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  data-autofocus
                  className="btn btn--primary"
                  onClick={() => onReply(lead.id)}
                >
                  Reply
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={onClose}
                  aria-label="Close lead detail"
                >
                  Close
                </button>
              </div>
            </div>

            <dl className="m-0 mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt className="text-[11px] uppercase tracking-[0.14em] text-chrome">Phone</dt>
              <dd className="m-0 min-w-0 break-words text-[12px] text-phosphor">
                {formatPhone(lead.phone)}
              </dd>
              <dt className="text-[11px] uppercase tracking-[0.14em] text-chrome">Product</dt>
              <dd className="m-0 min-w-0 break-words text-[12px] text-phosphor">{lead.product}</dd>
              <dt className="text-[11px] uppercase tracking-[0.14em] text-chrome">Value</dt>
              <dd className="m-0 min-w-0 break-words text-[12px] text-phosphor">
                {formatINR(lead.amountInr)}
              </dd>
              <dt className="text-[11px] uppercase tracking-[0.14em] text-chrome">Source</dt>
              <dd className="m-0 min-w-0 break-words text-[12px] text-phosphor">{lead.source}</dd>
            </dl>
          </header>

          {/* 2 - SLA strip ---------------------------------------------------- */}
          <section className="border-b border-rule p-3" aria-label="SLA">
            <h3 className="pane-title--readable m-0">Response SLA</h3>
            <p
              className={`m-0 mt-2 flex flex-wrap items-baseline gap-x-2 border-l-2 pl-2 ${SLA_TONE[slaState]}`}
            >
              <span className="text-[10px] uppercase tracking-[0.14em]">
                [{SLA_WORD[slaState]}]
              </span>
              <span className="text-base">{formatWait(waitMs)}</span>
              <span className="text-[11px] uppercase tracking-[0.14em]">
                {awaiting ? 'awaiting first reply' : 'replied'}
              </span>
            </p>
            <p className="m-0 mt-1 text-[11px] text-chrome">
              {awaiting
                ? `breach target ${slaMinutes}m &middot; thresholds ${thresholds.warnMinutes}m warn, ${thresholds.breachMinutes}m breach`
                : `first reply landed inside the ${slaMinutes}m target`}
            </p>
            {/* Only surfaced once it has actually gone wrong. */}
            {slaState === 'breach' ? (
              <p className="m-0 mt-1 text-[12px] text-breach">
                {Math.abs(overdue)}m past the breach threshold - reply now.
              </p>
            ) : null}
          </section>

          {/* 3 - transcript ---------------------------------------------------- */}
          {/*
            3 - transcript, rendered as a terminal log.

            CHOICE: a fixed-left `[in ]` / `[out]` mono gutter, with every row
            left-aligned. Right-aligning `out` rows was the alternative, and it
            was rejected: once messages are right-aligned the eye stops reading
            the gutter as a column, which is the only reason a log gutter exists.
            Direction is carried by three independent cues so it survives
            greyscale: the gutter word, a left rule (phosphor for `out`, the
            hairline for `in`) and the text colour.
          */}
          <section className="border-b border-rule p-3" aria-label="WhatsApp transcript">
            <h3 className="pane-title--readable m-0">Transcript</h3>
            {lead.transcript.length === 0 ? (
              <p className="m-0 mt-2 text-[12px] text-chrome">
                <span className="text-dim" aria-hidden="true">
                  {'// '}
                </span>
                no messages on this lead yet
              </p>
            ) : (
              <ul className="m-0 mt-2 list-none p-0">
                {lead.transcript.map((message) => {
                  const outgoing = message.direction === 'out';
                  return (
                    <li key={message.id} className="border-b border-rule py-1.5 last:border-b-0">
                      <div className="flex flex-wrap gap-x-2 text-[11px] text-chrome">
                        <span>{formatDateTime(message.at)}</span>
                        <span className={outgoing ? 'text-phosphor' : 'text-chrome'}>
                          <span className="visually-hidden">
                            {outgoing ? 'sent: ' : 'received: '}
                          </span>
                          {outgoing ? '[out]' : '[in ]'}
                        </span>
                      </div>
                      <p
                        dir="auto"
                        className={`m-0 mt-1 whitespace-pre-wrap break-words border-l-2 pl-2 text-[12px] ${
                          outgoing ? 'border-l-phosphor text-phosphor' : 'border-l-rule text-chrome'
                        }`}
                      >
                        {message.text}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 4 - timeline ------------------------------------------------------ */}
          <section className="border-b border-rule p-3" aria-label="Stage timeline">
            <h3 className="pane-title--readable m-0">Timeline</h3>
            {timeline.length === 0 ? (
              <p className="m-0 mt-2 text-[12px] text-chrome">
                <span className="text-dim" aria-hidden="true">
                  {'// '}
                </span>
                no stage changes recorded
              </p>
            ) : (
              <ol className="m-0 mt-2 list-none p-0">
                {timeline.map((event, index) => (
                  <li
                    key={`${event.at}|${event.stage}|${event.by}|${index}`}
                    className="flex flex-wrap gap-x-2 border-l-2 border-l-rule py-1 pl-2 text-[12px]"
                  >
                    <span className="text-chrome">{formatDateTime(event.at)}</span>
                    <span className="text-phosphor">{STAGE_LABEL[event.stage]}</span>
                    <span className="min-w-0 break-words text-chrome">by {event.by}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* 5 - notes --------------------------------------------------------- */}
          <section className="p-3" aria-label="Notes">
            <h3 className="pane-title--readable m-0">Notes</h3>
            {lead.notes.length === 0 ? (
              <p className="m-0 mt-2 text-[12px] text-chrome">
                <span className="text-dim" aria-hidden="true">
                  {'// '}
                </span>
                no notes yet - the first one is usually the price you quoted
              </p>
            ) : (
              <ul className="m-0 mt-2 list-none p-0">
                {lead.notes.map((note) => (
                  <li key={note.id} className="border-b border-rule py-1.5 last:border-b-0">
                    <p className="m-0 text-[11px] text-chrome">
                      {formatDateTime(note.at)} &middot; {note.by}
                    </p>
                    <p
                      dir="auto"
                      className="m-0 mt-0.5 whitespace-pre-wrap break-words text-[12px] text-chrome"
                    >
                      {note.text}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <form
              className="mt-3"
              onSubmit={(event) => {
                event.preventDefault();
                submitNote(lead.id);
              }}
            >
              <label className="visually-hidden" htmlFor="lead-drawer-note">
                Add a note to {lead.name}
              </label>
              <textarea
                id="lead-drawer-note"
                className="field"
                rows={3}
                value={noteText}
                placeholder="ctrl+enter to save"
                aria-invalid={noteError !== null}
                aria-describedby={noteError !== null ? 'lead-drawer-note-error' : undefined}
                onChange={(event) => {
                  setNoteText(event.target.value);
                  if (noteError !== null) setNoteError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    submitNote(lead.id);
                  }
                }}
              />
              {noteError !== null ? (
                <p
                  id="lead-drawer-note-error"
                  role="alert"
                  className="m-0 mt-1 text-[12px] text-amber"
                >
                  {noteError}
                </p>
              ) : null}
              <div className="mt-1 flex justify-end">
                <button type="submit" className="btn">
                  Save note
                </button>
              </div>
            </form>
          </section>
        </div>

        {/* controls - sticky so stage and owner are always reachable ---------- */}
        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-rule bg-panel2 p-3">
          <div className="min-w-0">
            <label
              className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-chrome"
              htmlFor="lead-drawer-stage"
            >
              Stage
            </label>
            <select
              id="lead-drawer-stage"
              className="field"
              value={lead.stage}
              onChange={(event) => {
                const stage = asStage(event.target.value);
                if (stage !== null) onStageChange(lead.id, stage);
              }}
            >
              {STAGE_ORDER.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABEL[stage]}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label
              className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-chrome"
              htmlFor="lead-drawer-owner"
            >
              Owner
            </label>
            <select
              id="lead-drawer-owner"
              className="field"
              value={lead.ownerId ?? UNASSIGNED}
              onChange={(event) =>
                onOwnerChange(
                  lead.id,
                  event.target.value === UNASSIGNED ? null : event.target.value,
                )
              }
            >
              <option value={UNASSIGNED}>Unassigned</option>
              {team.map((member: TeamMember) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
