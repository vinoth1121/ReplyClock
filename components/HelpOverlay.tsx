'use client';

/**
 * ReplyClock help overlay.
 *
 * Two reference lists, because the console has two learning surfaces: the
 * keyboard (the product's signature - an operator should never need the mouse)
 * and the command bar. The command list is rendered straight from
 * `COMMAND_HELP`, so the parser stays the single source of truth and a new
 * command cannot ship undocumented.
 *
 * Dismissal is deliberately generous - Escape, the close button, and a click on
 * the backdrop - because an overlay you cannot escape is a trap.
 *
 * NOTE ON DUPLICATION: `useModalDialog` is repeated rather than shared because
 * this file is one of a fixed set of five owned files.
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { COMMAND_HELP } from '@/lib/commands';

/** Shown only while `open`; the parent owns that flag. */
export interface HelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

/* ---------------------------------------------------------------------------
 * Focus trap - see LeadDrawer for the same implementation and rationale.
 * ------------------------------------------------------------------------ */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) => node.getClientRects().length > 0,
  );
}

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
 * Shortcut data
 * ------------------------------------------------------------------------ */

/** A keycap, or a plain word sitting between two keycaps. */
type Part =
  | { readonly kind: 'key'; readonly label: string; readonly unbound?: boolean }
  | { readonly kind: 'word'; readonly label: string };

interface Shortcut {
  readonly parts: readonly Part[];
  readonly action: string;
  readonly note?: string;
}

const key = (label: string): Part => ({ kind: 'key', label });
const word = (label: string): Part => ({ kind: 'word', label });

/**
 * The keyboard contract, in the order an operator learns it: move, open, act,
 * look around, escape.
 *
 * `a` is listed because it is part of the published shortcut set, but
 * `lib/commands.ts` PANE_ALIASES only binds q, f, s, r - so it is marked
 * unbound here rather than documented as working.
 */
const SHORTCUTS: readonly Shortcut[] = [
  { parts: [key('j'), key('\u2193')], action: 'Next lead in the queue' },
  { parts: [key('k'), key('\u2191')], action: 'Previous lead in the queue' },
  { parts: [key('Enter')], action: 'Open the selected lead detail' },
  { parts: [key('r')], action: 'Reply to the open lead' },
  { parts: [key('s')], action: 'Advance the open lead one stage' },
  { parts: [key('/')], action: 'Focus the search field' },
  { parts: [key('?')], action: 'Open this help overlay' },
  {
    parts: [key('g'), word('then'), key('q'), key('f'), key('a'), key('s'), key('r')],
    action: 'Jump to the queue, funnel, sources or response pane',
    note: 'a is not bound: the four panes are q, f, s, r',
  },
  { parts: [key('Esc')], action: 'Close the drawer, the composer or this overlay' },
  { parts: [key('Tab'), key('Shift+Tab')], action: 'Move focus forward and back' },
];

/** Dialog title id, for `aria-labelledby`. */
const TITLE_ID = 'help-overlay-title';

export function HelpOverlay({ open, onClose }: HelpOverlayProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalDialog(open, onClose, panelRef);

  // Return type is `JSX.Element | null` because an overlay that renders nothing
  // when closed cannot be typed `JSX.Element`.
  if (!open) return null;

  return (
    <div className="no-print fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-void/95">
      {/* Backdrop. A sibling of the panel rather than its background, so a click
          that lands outside the panel is unambiguous and no click handler has
          to be suppressed inside it. */}
      <div className="no-print fixed inset-0" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        tabIndex={-1}
        className="no-print relative mx-auto w-full min-w-0 max-w-[64rem] px-3 py-4"
      >
        <div className="pane">
          <span className="pane-corner pane-corner--tr" aria-hidden="true" />
          <span className="pane-corner pane-corner--bl" aria-hidden="true" />

          <div className="pane-head">
            <h2 id={TITLE_ID} className="pane-title--readable m-0">
              Help
            </h2>
            <button
              type="button"
              data-autofocus
              className="btn btn--ghost"
              onClick={onClose}
              aria-label="Close help"
            >
              Close
            </button>
          </div>

          <div className="pane-body p-3">
            {/* `pane-grid` is the existing two-on-desktop, one-on-mobile pair. */}
            <div className="pane-grid">
              <section aria-labelledby="help-shortcuts">
                <h3 id="help-shortcuts" className="pane-title--readable m-0">
                  Keyboard
                </h3>
                <dl className="m-0 mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                  {SHORTCUTS.map((shortcut) => (
                    <div key={shortcut.action} className="contents">
                      <dt className="m-0 flex flex-wrap items-center gap-1">
                        {shortcut.parts.map((part) =>
                          part.kind === 'word' ? (
                            <span key={part.label} className="text-[11px] text-chrome">
                              {part.label}
                            </span>
                          ) : (
                            <kbd
                              key={part.label}
                              className={`border px-1 text-[11px] ${
                                part.unbound === true
                                  ? 'border-rule text-dim line-through'
                                  : 'border-rule text-phosphor'
                              }`}
                            >
                              {part.label}
                              {part.unbound === true ? (
                                <span className="visually-hidden"> (not currently bound)</span>
                              ) : null}
                            </kbd>
                          ),
                        )}
                      </dt>
                      <dd className="m-0 min-w-0 text-[12px] text-chrome">
                        {shortcut.action}
                        {shortcut.note !== undefined ? (
                          <span className="mt-0.5 block text-[11px] text-chrome">
                            {shortcut.note}
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section aria-labelledby="help-commands">
                <h3 id="help-commands" className="pane-title--readable m-0">
                  Commands
                </h3>
                <dl className="m-0 mt-2">
                  {COMMAND_HELP.map((entry) => (
                    <div key={entry.usage} className="border-b border-rule py-1 last:border-b-0">
                      <dt className="m-0 break-words text-[12px] text-phosphor">{entry.usage}</dt>
                      <dd className="m-0 mt-0.5 text-[12px] text-chrome">{entry.summary}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>

            <p className="m-0 mt-3 text-[11px] text-chrome">
              <span className="text-dim" aria-hidden="true">
                {'// '}
              </span>
              click outside, press Esc, or close - any of the three
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
