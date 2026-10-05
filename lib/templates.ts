/**
 * WhatsApp reply templates for the ReplyClock composer.
 *
 * A template is plain copy with `{token}` placeholders. The operator fills the
 * tokens, previews the result, and hands it to {@link buildWaLink}, which opens
 * a real `https://wa.me/<number>?text=<encoded>` link. Sending that link is what
 * records the first reply and stops the SLA timer, so every body is written to
 * be read on a phone and answered quickly.
 *
 * Pure module: standard library only, no clock, no network, never throws.
 */

/** A fill-in slot a template body may reference. */
export type TemplateVariable = 'name' | 'product' | 'amount_inr';

/** One selectable reply, as shown in the composer picker. */
export interface ReplyTemplate {
  /** Stable kebab-case key, safe to persist alongside a sent message. */
  id: string;
  /** Short human name for the picker. */
  label: string;
  /** One line: when an operator should reach for this template. */
  summary: string;
  /** Message copy; may contain `{name}`, `{product}` and `{amount_inr}`. */
  body: string;
  /** Variables actually used by `body`, de-duplicated, in canonical order. */
  variables: TemplateVariable[];
}

/** Token pattern, shared by variable discovery and rendering. */
const TOKEN_RE = /\{(\w+)\}/g;

/** Display order for variables in the picker and in {@link missingVariables}. */
const VARIABLE_ORDER: readonly TemplateVariable[] = ['name', 'product', 'amount_inr'];

/** Widened view of {@link VARIABLE_ORDER}, used for membership tests. */
const VARIABLE_NAMES: readonly string[] = VARIABLE_ORDER;

/** A template as authored; `variables` is derived, never hand-written. */
type TemplateDraft = Omit<ReplyTemplate, 'variables'>;

function isTemplateVariable(token: string): token is TemplateVariable {
  return VARIABLE_NAMES.includes(token);
}

/** Coerces any runtime value to a string, empty for `null`/`undefined`/junk. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Normalises the caller-supplied value map instead of trusting its shape. */
function asVarMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  return value as Record<string, string>;
}

/**
 * A supplied value counts only if it carries content: absent, empty or
 * whitespace-only tokens render as `''`, because stray braces in a WhatsApp
 * message read worse than a blank.
 */
function supplied(value: string | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim().length > 0 ? value : '';
}

/** Every `{token}` name in `body`, in first-seen order, duplicates included. */
function findTokens(body: string): string[] {
  const found: string[] = [];
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null = TOKEN_RE.exec(body);
  while (match !== null) {
    const token = match[1];
    if (typeof token === 'string') found.push(token);
    match = TOKEN_RE.exec(body);
  }
  return found;
}

/**
 * The variables `body` actually uses: de-duplicated and returned in the
 * canonical `name, product, amount_inr` order. Both `TEMPLATES[].variables`
 * and {@link missingVariables} are built from this, so a declared variable
 * list can never drift away from the copy it describes.
 */
function collectVariables(body: string): TemplateVariable[] {
  const used = new Set<TemplateVariable>();
  for (const token of findTokens(asText(body))) {
    if (isTemplateVariable(token)) used.add(token);
  }
  return VARIABLE_ORDER.filter((variable) => used.has(variable));
}

/** Completes a hand-written draft with its derived `variables` list. */
function defineTemplate(draft: TemplateDraft): ReplyTemplate {
  return { ...draft, variables: collectVariables(draft.body) };
}

/**
 * The reply library, in the order an operator works a lead through it:
 * open, price, re-open, close.
 */
export const TEMPLATES: readonly ReplyTemplate[] = [
  defineTemplate({
    id: 'first-touch',
    label: 'First touch',
    summary: 'The very first reply, while the lead is still on the ad page.',
    body: `Hi {name}, thanks for messaging about the {product}.
Should I send you the full price list on WhatsApp, or call you for two minutes?`,
  }),
  defineTemplate({
    id: 'quote',
    label: 'Send quote',
    summary: 'Price sent: amount up front, GST called out, one qualifying question.',
    body: `Hi {name}, here is the quote for the {product}: {amount_inr}, GST extra.
This holds for the next 4 days. After that I will have to revise it.
So I get the details right: is this on a loan, or are you paying cash?`,
  }),
  defineTemplate({
    id: 'nudge',
    label: 'Gentle nudge',
    summary: 'Lead went quiet after the first reply - one easy reason to come back.',
    body: `Hi {name}, did the details I sent make sense, or is something still unclear?
Happy to answer anything on this. If the timing is not right, just tell me and I will leave it there.`,
  }),
  defineTemplate({
    id: 'closing',
    label: 'Payment link',
    summary: 'Deal agreed - confirm the amount and spell out how to pay.',
    body: `Hi {name}, we are good on the {product} at {amount_inr}, GST extra.
I will send the invoice to the email you registered with within the next 10 minutes, and you can pay from the link inside it.
Once the payment comes through your slot is confirmed, and I will call to fix the exact timing.`,
  }),
];

/**
 * Substitutes `{token}` placeholders in `body` with `vars[token]`. Any token
 * with no entry, or an empty/whitespace-only one, is replaced with `''`.
 * Surrounding text and newlines are left untouched; the call never throws.
 */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  const text = asText(body);
  if (text.length === 0) return '';
  const map = asVarMap(vars);
  TOKEN_RE.lastIndex = 0;
  return text.replace(TOKEN_RE, (_token: string, name: string) => supplied(map[name]));
}

/**
 * The variables `body` needs that `vars` does not already supply, in the
 * canonical `name, product, amount_inr` order. `[]` means the message is ready
 * to send.
 */
export function missingVariables(body: string, vars: Record<string, string>): TemplateVariable[] {
  const map = asVarMap(vars);
  return collectVariables(body).filter((variable) => supplied(map[variable]) === '');
}

/** A bare ten-digit Indian mobile, which still needs its country code. */
const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;

/**
 * Digits only, country code included. Leading `+` and any punctuation, spaces
 * or brackets are dropped, and a bare ten-digit Indian mobile gains `91`.
 */
function normalisePhone(phone: string): string {
  const cleaned = asText(phone).trim().replace(/^\++/, '').replace(/\D+/g, '');
  if (cleaned.length === 0) return '';
  return INDIAN_MOBILE_RE.test(cleaned) ? `91${cleaned}` : cleaned;
}

/**
 * The click-to-chat link for `text`, or `''` when `phone` holds no usable
 * digits - a broken link is worse than none. The text is percent-encoded so
 * spaces, `&` and `=` cannot break the query string.
 */
export function buildWaLink(phone: string, text: string): string {
  const digits = normalisePhone(phone);
  if (digits.length === 0) return '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(asText(text))}`;
}
