/**
 * ReplyClock printable GST quote.
 *
 * The one surface in the product that is meant to leave the screen. On paper
 * `app/globals.css` forces `html, body` to white/black, so this component is
 * dark-on-light everywhere: no phosphor fill (it would print as a solid slab or
 * drop out entirely) and no reliance on inherited colour - every rule here is
 * explicitly `text-black` / `border-black`.
 *
 * PRINT PLACEMENT - the load-bearing detail:
 * `display: none` on an ancestor beats `display: block !important` on a
 * descendant, so the `.print-only` invoice must NOT live inside anything
 * marked `.no-print`, and must not sit inside a `position: fixed` box either
 * (a fixed box on paper is pinned to the page box and clips). It is therefore
 * rendered as a first-child sibling of the screen layer, in normal document
 * flow, so the page lays it out like any other content and nothing is cut off.
 * On screen it is `display: none` and occupies no space.
 *
 * The screen layer is `.no-print` throughout, so pressing Print emits the quote
 * and nothing else from this component.
 */

'use client';

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { formatDateTime, formatPhone } from '@/lib/format';
import type { Lead } from '@/types';

export interface InvoiceStubProps {
  lead: Lead;
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
 * Money
 * ------------------------------------------------------------------------ */

/**
 * Why not `formatINR` from `lib/format.ts`: it pins `maximumFractionDigits: 0`,
 * so it renders a tax line as "\u20B911,250" and silently drops the paise. A
 * GST quote whose CGST/SGST lines are rounded to whole rupees is not a quote.
 * The tax lines need exactly two decimals, so this component formats with its
 * own `en-IN` formatter and prefixes the rupee sign itself.
 *
 * `en-IN` grouping is the Indian lakh/crore pattern, so 111000 groups as
 * `1,11,000.00`, not `111,000.00` - verified in the build report.
 */
const TAX_GROUPED = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Two-decimal rupee amount, e.g. `\u20B91,11,000.00`. */
function rupees(amount: number): string {
  return `\u20B9${TAX_GROUPED.format(amount)}`;
}

/** Round to paise. GST is quoted to the paisa, so every line is rounded once. */
function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Intra-state supply: CGST 9% + SGST 9%. */
const GST_RATE = 0.09;

/** Every figure for one lead, computed once, already rounded to paise. */
interface Totals {
  taxable: number;
  cgst: number;
  sgst: number;
  total: number;
}

function totalsFor(lead: Lead): Totals {
  const raw = Number.isFinite(lead.amountInr) ? lead.amountInr : 0;
  const taxable = round2(raw);
  const cgst = round2(taxable * GST_RATE);
  const sgst = round2(taxable * GST_RATE);
  return { taxable, cgst, sgst, total: round2(taxable + cgst + sgst) };
}

/**
 * Seller identity. Entirely invented: `SWAPN TELECOM` is not a real trading
 * name and the GSTIN `29ABCDE1234F1Z5` is a deliberately well-formed but
 * fictional identifier (29 = Karnataka, matching the address below it).
 */
const SELLER = {
  name: 'SWAPN TELECOM PRIVATE LIMITED',
  address: [
    '3rd Floor, Sterling Arcade',
    '100 Feet Road, Indiranagar',
    'Bengaluru, Karnataka 560038',
  ],
  gstin: '29ABCDE1234F1Z5',
} as const;

/** Dialog title id, for `aria-labelledby`. */
const TITLE_ID = 'invoice-stub-title';

export function InvoiceStub({ lead, onClose }: InvoiceStubProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalDialog(true, onClose, panelRef);

  const totals = totalsFor(lead);
  const quoteNumber = `QT-${lead.id}`;
  // No `Date.now()` anywhere in this project; `createdAt` is the only clock
  // input the props carry, and it is also the honest "as at" date for a quote
  // raised off the back of an enquiry.
  const quoteDate = formatDateTime(lead.createdAt);

  function handlePrint(): void {
    if (typeof window === 'undefined') return;
    window.print();
  }

  return (
    <>
      {/* ---- print layer: static, in flow, first so it lands on page 1 ------- */}
      <article
        className="print-only relative mx-auto w-full max-w-[180mm] bg-white p-3 text-black"
        aria-label={`Quotation ${quoteNumber} for ${lead.name}`}
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-black pb-2">
          <div>
            <p className="m-0 text-[10px] uppercase tracking-[0.14em]">Quotation</p>
            <h1 className="m-0 mt-0.5 text-lg">{SELLER.name}</h1>
          </div>
          <dl className="m-0 text-[11px]">
            <dt className="inline uppercase tracking-[0.14em]">Quote no.</dt>
            <dd className="m-0 inline font-bold">{quoteNumber}</dd>
            <dt className="mt-1 inline uppercase tracking-[0.14em]">Date</dt>
            <dd className="m-0 inline font-bold">{quoteDate}</dd>
          </dl>
        </header>

        <div className="mt-3 flex flex-wrap gap-6 text-[11px]">
          <section className="min-w-[12rem] flex-1">
            <h2 className="m-0 uppercase tracking-[0.14em]">Seller</h2>
            <p className="m-0 mt-1 font-bold">{SELLER.name}</p>
            {SELLER.address.map((line) => (
              <p key={line} className="m-0">
                {line}
              </p>
            ))}
            <p className="m-0 mt-1">
              <span className="uppercase tracking-[0.14em]">GSTIN </span>
              <span className="font-bold">{SELLER.gstin}</span>
            </p>
          </section>
          <section className="min-w-[12rem] flex-1">
            <h2 className="m-0 uppercase tracking-[0.14em]">Buyer</h2>
            <p className="m-0 mt-1 font-bold">{lead.name}</p>
            <p className="m-0">{lead.city}</p>
            <p className="m-0">{formatPhone(lead.phone)}</p>
            <p className="m-0 mt-1">
              <span className="uppercase tracking-[0.14em]">Lead ref </span>
              <span className="font-bold">{lead.id}</span>
            </p>
          </section>
        </div>

        <table className="mt-4 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-y border-black text-left">
              <th scope="col" className="py-1 pr-2 font-bold uppercase tracking-[0.14em]">
                Description
              </th>
              <th
                scope="col"
                className="py-1 pr-2 text-right font-bold uppercase tracking-[0.14em]"
              >
                Qty
              </th>
              <th
                scope="col"
                className="py-1 pr-2 text-right font-bold uppercase tracking-[0.14em]"
              >
                Unit price
              </th>
              <th scope="col" className="py-1 text-right font-bold uppercase tracking-[0.14em]">
                Taxable amount
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-black">
              <td className="py-1 pr-2">{lead.product}</td>
              <td className="py-1 pr-2 text-right">1</td>
              <td className="py-1 pr-2 text-right">{rupees(totals.taxable)}</td>
              <td className="py-1 text-right">{rupees(totals.taxable)}</td>
            </tr>
            <tr className="border-b border-black">
              <td className="py-1 pr-2" colSpan={3}>
                <span className="uppercase tracking-[0.14em]">CGST 9%</span>
              </td>
              <td className="py-1 text-right">{rupees(totals.cgst)}</td>
            </tr>
            <tr className="border-b border-black">
              <td className="py-1 pr-2" colSpan={3}>
                <span className="uppercase tracking-[0.14em]">SGST 9%</span>
              </td>
              <td className="py-1 text-right">{rupees(totals.sgst)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-y-2 border-black">
              <th
                scope="row"
                colSpan={3}
                className="py-1 pr-2 text-left font-bold uppercase tracking-[0.14em]"
              >
                Total
              </th>
              <td className="py-1 text-right text-[13px] font-bold">{rupees(totals.total)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="m-0 mt-3 text-[10px] leading-relaxed">
          GST is charged at 18% in total, split evenly into CGST 9% and SGST 9% as an intra-state
          supply. The taxable value above is exclusive of GST. This is a computer-generated quote
          and does not require a signature. Prices are held for 4 days from the date above.
        </p>
      </article>

      {/* ---- screen layer: chrome only, fully suppressed on paper ---------- */}
      <div className="no-print fixed inset-0 z-50 overflow-y-auto bg-void">
        <div className="no-print fixed inset-0 bg-void/85" onClick={onClose} aria-hidden="true" />

        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
          tabIndex={-1}
          className="no-print relative mx-auto flex min-h-full w-full max-w-[180mm] flex-col p-3 sm:my-6"
        >
          <div className="pane flex min-h-0 flex-1 flex-col">
            <div className="pane-head">
              <h2 id={TITLE_ID} className="pane-title--readable m-0">
                Quote {quoteNumber}
              </h2>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={onClose}
                aria-label="Close quote"
              >
                Close
              </button>
            </div>

            <div className="pane-body flex-1 p-3">
              <p className="m-0 text-[12px] text-chrome">
                {quoteNumber} for {lead.name} &middot; {lead.product} &middot;{' '}
                <span className="text-phosphor">{rupees(totals.total)}</span> including GST
              </p>
              <p className="m-0 mt-2 text-[12px] text-chrome">
                <span className="text-dim" aria-hidden="true">
                  {'// '}
                </span>
                the quote itself only exists on paper - Print, or save it as a PDF
              </p>
              <p className="m-0 mt-1 text-[11px] text-chrome">use ctrl+p to save as pdf</p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-rule p-3">
              <button type="button" className="btn" onClick={onClose}>
                Back to lead
              </button>
              <button
                type="button"
                data-autofocus
                className="btn btn--primary"
                onClick={handlePrint}
              >
                Print quote
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
