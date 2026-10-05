/**
 * ReplyClock reply composer.
 *
 * The product's signature flow: pick a template, fill the variables it actually
 * uses, read exactly what the customer will receive, then hand it to WhatsApp.
 * Opening the WhatsApp link is what records the first reply, so the send
 * action is an anchor with a real href and its label states the outcome
 * ("Open WhatsApp and record reply") rather than a vaguer "Send".
 *
 * Nothing here is fetched and no clock is read: the lead arrives as a prop and
 * every value is derived from it.
 *
 * NOTE ON DUPLICATION: `useModalDialog` is repeated rather than shared because
 * this file is one of a fixed set of five owned files; a sixth module for the
 * hook is out of scope.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { formatDateTime, formatINR, formatPhone } from '@/lib/format';
import { TEMPLATES, buildWaLink, missingVariables, renderTemplate } from '@/lib/templates';
import type { ReplyTemplate, TemplateVariable } from '@/lib/templates';
import type { Lead } from '@/types';

export interface ReplyComposerProps {
  lead: Lead;
  onCancel: () => void;
  onSend: (leadId: string, renderedText: string) => void;
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
 * Seeding
 * ------------------------------------------------------------------------ */

/**
 * The `amount_inr` seed, and the reason the rupee sign has to come off.
 *
 * `lib/templates.ts` states the contract explicitly: no template body contains
 * a rupee sign, and `{amount_inr}` is always a bare grouped number - the copy
 * reads "here is the quote for the {product}: {amount_inr}, GST extra."
 * `formatINR` returns the symbol with the number ("\u20B91,11,000"). Seeding the
 * field with that would push a currency glyph the copy never asked for, and in
 * a body that had grown its own sign it would render "\u20B9\u20B91,11,000".
 *
 * The replace is anchored with `^` and uses `+` so it strips every leading sign
 * rather than exactly one, and only from the front, so a grouped number that
 * legitimately contained a "9" or a comma is never touched.
 */
const LEADING_RUPEE = /^\u20B9+/;

/** Pre-fills the three slots from the lead. Only the used ones are rendered. */
function seedVarsFor(lead: Lead): Record<TemplateVariable, string> {
  return {
    name: lead.name.trim(),
    product: lead.product.trim(),
    amount_inr: formatINR(lead.amountInr).replace(LEADING_RUPEE, ''),
  };
}

/** First template in the library, resolved defensively. */
const DEFAULT_TEMPLATE_ID = TEMPLATES[0]?.id ?? '';

/** Everything each slot means, so the form teaches while it is being filled. */
const VARIABLE_HINT: Record<TemplateVariable, string> = {
  name: 'their first name, as they gave it on WhatsApp',
  product: 'the product they asked about',
  amount_inr: 'in rupees, GST extra - do not type a rupee sign here',
};

/** The composer's title element id, for `aria-labelledby`. */
const TITLE_ID = 'reply-composer-title';

/** Stable, unique ids for each option button. */
const optionId = (template: ReplyTemplate): string => `reply-template-${template.id}`;

/**
 * Names the specific slot that is blocking the send. Terminal voice: no
 * apology, and it says what to do next rather than only what is wrong.
 */
function missingMessage(missing: readonly TemplateVariable[]): string {
  const names = missing.map((variable) => variable);
  const last = names[names.length - 1];
  if (names.length === 1) return `Fill in ${last} before sending this reply.`;
  return `Fill in ${names.slice(0, -1).join(', ')} and ${last} before sending this reply.`;
}

export function ReplyComposer({ lead, onCancel, onSend }: ReplyComposerProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalDialog(true, onCancel, panelRef);

  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [vars, setVars] = useState<Record<TemplateVariable, string>>(() => seedVarsFor(lead));

  // Re-seed only when the lead itself changes, never on a re-render: a fresh
  // lead object with the same id must not wipe what the operator has typed.
  const leadRef = useRef(lead);
  useEffect(() => {
    setSelectedTemplateId(DEFAULT_TEMPLATE_ID);
    setVars(seedVarsFor(leadRef.current));
  }, [leadRef, lead.id]);

  const template = TEMPLATES.find((candidate) => candidate.id === selectedTemplateId) ?? null;

  if (template === null) {
    return (
      <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-void p-4">
        <p role="alert" className="m-0 max-w-sm border border-amber p-3 text-[12px] text-amber">
          No reply template is available in this build. Close this panel and reply on WhatsApp by
          hand.
        </p>
      </div>
    );
  }

  const rendered = renderTemplate(template.body, vars);
  const missing = missingVariables(template.body, vars);
  const link = buildWaLink(lead.phone, rendered);
  // One gate for the action: a send needs a number to send to AND a complete
  // message, otherwise the customer would receive a blank or half-written reply.
  const canSend = missing.length === 0 && link !== '';

  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-void/85 sm:items-center sm:p-4">
      <div className="absolute inset-0" onClick={onCancel} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        tabIndex={-1}
        className="relative flex max-h-full w-full max-w-[40rem] flex-col overflow-hidden border border-rule bg-panel sm:max-h-[90vh]"
      >
        <div className="pane-head shrink-0">
          <h2 id={TITLE_ID} className="pane-title--readable m-0">
            Reply to {lead.name}
          </h2>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onCancel}
            aria-label="Cancel reply"
          >
            Cancel
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-3">
          {/* template picker ------------------------------------------------- */}
          <div role="group" aria-label="Reply template" className="grid gap-1">
            {TEMPLATES.map((candidate, index) => {
              const selected = candidate.id === template.id;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  id={optionId(candidate)}
                  data-autofocus={index === 0 ? '' : undefined}
                  aria-pressed={selected}
                  onClick={() => setSelectedTemplateId(candidate.id)}
                  className={`flex w-full items-start gap-2 border p-2 text-left ${
                    selected ? 'border-phosphor bg-panel2' : 'border-rule'
                  }`}
                >
                  {/*
                    The marker is the non-colour selection cue; `aria-pressed`
                    carries the same fact to assistive tech. The cell is a fixed
                    width so the four labels stay in one column.
                  */}
                  <span
                    aria-hidden="true"
                    className="inline-block w-3 shrink-0 text-[12px] text-phosphor"
                  >
                    {selected ? '\u25B8' : '\u00A0'}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] text-phosphor">{candidate.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-chrome">
                      {candidate.summary}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* variable inputs - only the slots this body actually references --- */}
          {template.variables.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {template.variables.map((variable) => {
                const inputId = `reply-var-${variable}`;
                const hintId = `${inputId}-hint`;
                return (
                  <div key={variable}>
                    <label
                      htmlFor={inputId}
                      className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-chrome"
                    >
                      {variable}
                    </label>
                    <input
                      id={inputId}
                      className="field"
                      type="text"
                      value={vars[variable]}
                      aria-invalid={missing.includes(variable)}
                      aria-describedby={hintId}
                      onChange={(event) =>
                        setVars((previous) => ({ ...previous, [variable]: event.target.value }))
                      }
                    />
                    <p id={hintId} className="m-0 mt-1 text-[11px] text-chrome">
                      {VARIABLE_HINT[variable]}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="m-0 mt-3 text-[12px] text-chrome">This template needs no variables.</p>
          )}

          {/* live preview - the emotional centre of the feature -------------- */}
          {/*
            Deliberately the heaviest block in the product: it is a raised
            panel with a phosphor rule down its left edge and the message
            itself in phosphor, because this text is the reply. `whitespace-pre-wrap`
            is load-bearing - the templates are multi-line and the customer
            will read the line breaks exactly as they appear here.
          */}
          <section className="mt-3" aria-label="Message preview">
            <h3 className="pane-title--readable m-0">Preview</h3>
            <p className="m-0 mt-1 text-[11px] text-chrome">
              to {formatPhone(lead.phone)} &middot; queued {formatDateTime(lead.createdAt)}
            </p>
            <p
              dir="auto"
              className="m-0 mt-1 whitespace-pre-wrap break-words border-l-2 border-l-phosphor bg-panel2 p-3 text-[12px] leading-relaxed text-phosphor"
            >
              {rendered}
            </p>
          </section>

          {/* action ------------------------------------------------------------ */}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-rule pt-3">
            {canSend ? (
              <a
                className="btn btn--primary"
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onSend(lead.id, rendered)}
              >
                Open WhatsApp and record reply
              </a>
            ) : (
              <button type="button" className="btn btn--primary" disabled>
                Open WhatsApp and record reply
              </button>
            )}
          </div>
          {link === '' ? (
            <p className="m-0 mt-2 text-right text-[12px] text-amber">
              This lead has no usable WhatsApp number. Add a 10-digit mobile or a number with a
              country code, then send the preview above by hand.
            </p>
          ) : missing.length > 0 ? (
            <p role="alert" className="m-0 mt-2 text-right text-[12px] text-amber">
              {missingMessage(missing)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
