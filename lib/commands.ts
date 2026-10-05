/**
 * ReplyClock command bar parser.
 *
 * Every export is pure: no clock reads, no randomness, no I/O, no output. The
 * parser never throws - any input, including junk and empty strings, returns a
 * {@link CommandOk} or a {@link CommandErr}. Error voice is terminal: terse,
 * lowercase, no apology, always paired with an actionable hint.
 */

import type { PaneId, SlaState, SortField, Stage } from '@/types';

/** Everything the parser needs to know about the current console state. */
export interface CommandContext {
  /** Team member display names, e.g. `['Priya Sharma', ...]`. */
  owners: string[];
  /** Ad names, e.g. `['CTWA-Diwali-Offer', ...]`. */
  sources: string[];
}

/** Axis a `filter` command constrains. */
export type FilterField = 'stage' | 'source' | 'owner' | 'state';

/** What the UI should do once a line has been accepted. */
export type CommandIntent =
  | { kind: 'filter'; field: FilterField; value: string }
  | { kind: 'sort'; field: SortField }
  | { kind: 'owner'; value: string }
  | { kind: 'sla'; minutes: number }
  | { kind: 'search'; value: string }
  | { kind: 'help' }
  | { kind: 'scanlines'; value: 'on' | 'off' | 'toggle' }
  | { kind: 'clear' }
  | { kind: 'goto'; pane: PaneId }
  | { kind: 'unknown'; raw: string };

export interface CommandOk {
  ok: true;
  intent: CommandIntent;
  echo: string;
}

export interface CommandErr {
  ok: false;
  message: string;
  hint: string;
}

export type CommandResult = CommandOk | CommandErr;

export interface CommandHelpEntry {
  usage: string;
  summary: string;
}

/** Help overlay contents, most useful first. Covers every supported command. */
export const COMMAND_HELP: readonly CommandHelpEntry[] = [
  { usage: 'help', summary: 'list every command' },
  { usage: 'filter stage=new|talks|negotiation|closed|all', summary: 'show leads in one stage' },
  { usage: 'filter state=ok|warn|breach|all', summary: 'show leads by sla health' },
  { usage: 'filter owner=<first last>|unassigned|all', summary: 'show leads by assigned seller' },
  { usage: 'filter source=<ad>|all', summary: 'show leads by ad or campaign name' },
  { usage: 'sort wait|created|amount|name', summary: 'order the lead list' },
  { usage: 'sla <minutes>', summary: 'set the breach threshold, 2-1440' },
  { usage: 'owner <name>', summary: 'assign the selected lead to a seller' },
  { usage: 'search <query>', summary: 'find leads by name, id, phone or city' },
  { usage: 'goto q|f|s|r', summary: 'jump to queue, funnel, sources or response' },
  { usage: 'scanlines on|off|toggle', summary: 'toggle the crt scanline overlay' },
  { usage: 'clear', summary: 'reset filters, sort and search to defaults' },
];

const SLA_MIN_MINUTES = 2;
const SLA_MAX_MINUTES = 1440;
const MAX_SUGGESTIONS = 8;
const HINT_LIMIT = 6;

const STAGE_VALUES: readonly (Stage | 'all')[] = ['new', 'talks', 'negotiation', 'closed', 'all'];
const STATE_VALUES: readonly (SlaState | 'all')[] = ['ok', 'warn', 'breach', 'all'];
const SORT_FIELDS: readonly SortField[] = ['wait', 'created', 'amount', 'name'];
const PANE_IDS: readonly PaneId[] = ['queue', 'funnel', 'sources', 'response'];
const SCANLINE_MODES: readonly ('on' | 'off' | 'toggle')[] = ['on', 'off', 'toggle'];
const VERBS: readonly string[] = [
  'filter',
  'sort',
  'owner',
  'sla',
  'search',
  'scanlines',
  'clear',
  'goto',
  'help',
];
const FILTER_FIELDS: readonly FilterField[] = ['stage', 'state', 'owner', 'source'];
const STARTING_COMMANDS: readonly string[] = [
  'help',
  'filter stage=',
  'sort wait',
  'sla 45',
  'owner ',
  'search ',
  'clear',
];

const PANE_ALIASES: Readonly<Record<string, PaneId>> = {
  q: 'queue',
  queue: 'queue',
  f: 'funnel',
  funnel: 'funnel',
  s: 'sources',
  sources: 'sources',
  r: 'response',
  response: 'response',
};

const STAGE_HINT = `stages: ${STAGE_VALUES.join(', ')}`;
const STATE_HINT = `states: ${STATE_VALUES.join(', ')}`;
const SORT_HINT = `sort fields: ${SORT_FIELDS.join(', ')}`;
const PANE_HINT = 'panes: q queue, f funnel, s sources, r response';
const SCANLINE_HINT = 'scanlines on|off|toggle';
const SLA_HINT = `whole minutes, ${SLA_MIN_MINUTES}-${SLA_MAX_MINUTES}`;
const UNASSIGNED_HINT = 'list unassigned leads with: filter owner=unassigned';
const CLEARED_ECHO = 'filters cleared';

function ok(intent: CommandIntent, echo: string): CommandOk {
  return { ok: true, intent, echo };
}

function fail(message: string, hint: string): CommandErr {
  return { ok: false, message, hint };
}

/** Edit distance over two short words, two-row dynamic program. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      const swap = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      cur[j] = swap;
    }
    const row = prev;
    prev = cur;
    cur = row;
  }
  return prev[b.length] ?? 0;
}

/** Verbs within `maxDistance` edits of `word`, closest first. */
function nearestVerbs(word: string, maxDistance: number): string[] {
  const scored = VERBS.map((verb) => ({ verb, distance: levenshtein(word, verb) }));
  return scored
    .filter((entry) => entry.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .map((entry) => entry.verb);
}

/** One transposition or two edits away still counts as a near miss. */
function tolerance(word: string): number {
  return Math.max(1, Math.ceil(word.length / 3));
}

/** Defensive read of a caller supplied string list. */
function listOf(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
}

/** Exact, then first name or initials, then substring: `ps` finds 'Priya Sharma'. */
function matchKnown(raw: string, list: readonly string[]): string | undefined {
  const needle = raw.trim().toLowerCase();
  if (needle.length === 0) return undefined;
  for (const item of list) if (item.trim().toLowerCase() === needle) return item;
  for (const item of list) {
    const words = item
      .toLowerCase()
      .split(/[\s._-]+/)
      .filter((w) => w.length > 0);
    if (words[0] === needle) return item;
    if (words.map((w) => w.charAt(0)).join('') === needle) return item;
  }
  for (const item of list) if (item.toLowerCase().includes(needle)) return item;
  return undefined;
}

/** `owners: a, b, c, +4 more` - the tail is dropped once the list gets long. */
function listHint(label: string, list: readonly string[]): string {
  if (list.length === 0) return `${label}: none loaded`;
  if (list.length <= HINT_LIMIT) return `${label}: ${list.join(', ')}`;
  return `${label}: ${list.slice(0, HINT_LIMIT).join(', ')}, +${list.length - HINT_LIMIT} more`;
}

/** Resolve a name against `ctx`, or fail with everything that does exist. */
function resolveName(
  value: string,
  ctx: CommandContext | undefined,
  field: 'owner' | 'source',
): string | CommandErr {
  const list = field === 'owner' ? listOf(ctx?.owners) : listOf(ctx?.sources);
  if (list.length === 0) return value;
  const hit = matchKnown(value, list);
  if (hit !== undefined) return hit;
  const subject = field === 'owner' ? 'team member' : 'ad';
  return fail(`no ${subject} matches '${value}'`, listHint(`${field}s`, list));
}

/** Index of the first `=` or `:`, so both separators behave the same. */
function firstSeparator(token: string): number {
  const equals = token.indexOf('=');
  const colon = token.indexOf(':');
  if (equals < 0) return colon;
  if (colon < 0) return equals;
  return Math.min(equals, colon);
}

/** Narrows a raw token to a known union member without a cast. */
function oneOf<T extends string>(value: string, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

/** Hint text for a filter axis, using `ctx` when the console supplied one. */
function fieldHint(field: FilterField, ctx: CommandContext | undefined): string {
  if (field === 'stage') return STAGE_HINT;
  if (field === 'state') return STATE_HINT;
  if (field === 'owner') return listHint('owners', listOf(ctx?.owners));
  return listHint('sources', listOf(ctx?.sources));
}

/**
 * `filter` owns the whole rest of the line, so a value may contain spaces:
 * `owner=Vikram Rao` is one argument, not two. The one shape it cannot
 * take is a second `key=value` pair, spotted as a later token with its own
 * separator.
 */
function filterArgument(rest: readonly string[]): string | CommandErr {
  if (rest.length === 0) return fail("'filter' needs a field and a value", 'e.g. filter stage=new');
  const head = rest[0] ?? '';
  const pairs = rest.slice(1).filter((token) => firstSeparator(token) >= 0);
  if (firstSeparator(head) >= 0 && pairs.length > 0)
    return fail("'filter' takes one key=value, got two", 'e.g. filter stage=new');
  return rest.join(' ').trim();
}

function parseFilter(rest: readonly string[], ctx: CommandContext | undefined): CommandResult {
  const token = filterArgument(rest);
  if (typeof token !== 'string') return token;
  const cut = firstSeparator(token);
  if (cut < 0) return fail(`'${token}' is not a filter field`, 'e.g. filter stage=new');
  const key = token.slice(0, cut).trim().toLowerCase();
  const value = token.slice(cut + 1).trim();
  const field = oneOf(key, FILTER_FIELDS);
  if (field === undefined)
    return fail(`unknown filter '${key}'`, 'filters: stage, state, owner, source');
  if (value.length === 0) return fail(`filter ${key}= has no value`, fieldHint(field, ctx));
  if (field === 'stage') {
    const stage = oneOf(value.toLowerCase(), STAGE_VALUES);
    if (stage === undefined) return fail(`unknown stage '${value}'`, STAGE_HINT);
    return ok({ kind: 'filter', field, value: stage }, `stage=${stage}`);
  }
  if (field === 'state') {
    const state = oneOf(value.toLowerCase(), STATE_VALUES);
    if (state === undefined) return fail(`unknown state '${value}'`, STATE_HINT);
    return ok({ kind: 'filter', field, value: state }, `state=${state}`);
  }
  if (value.toLowerCase() === 'all')
    return ok({ kind: 'filter', field, value: 'all' }, `${field}=all`);
  if (field === 'owner' && value.toLowerCase() === 'unassigned') {
    return ok({ kind: 'filter', field, value: 'unassigned' }, 'owner=unassigned');
  }
  const hit = resolveName(value, ctx, field);
  if (typeof hit !== 'string') return hit;
  return ok({ kind: 'filter', field, value: hit }, `${field}=${hit}`);
}

function parseSort(rest: readonly string[]): CommandResult {
  if (rest.length === 0) return fail("'sort' needs a field", SORT_HINT);
  if (rest.length > 1) return fail("'sort' takes one field", SORT_HINT);
  const value = (rest[0] ?? '').trim().toLowerCase();
  const field = oneOf(value, SORT_FIELDS);
  if (field === undefined) return fail(`unknown sort field '${value}'`, SORT_HINT);
  return ok({ kind: 'sort', field }, `sort=${value}`);
}

function parseOwner(rest: readonly string[], ctx: CommandContext | undefined): CommandResult {
  if (rest.length === 0) return fail("'owner' needs a name", 'owner priya');
  const value = rest.join(' ').trim();
  if (value.toLowerCase() === 'unassigned')
    return fail("'unassigned' is not a person", UNASSIGNED_HINT);
  const hit = resolveName(value, ctx, 'owner');
  if (typeof hit !== 'string') return hit;
  return ok({ kind: 'owner', value: hit }, `owner=${hit}`);
}

function parseSla(rest: readonly string[]): CommandResult {
  const example = `${SLA_HINT}, e.g. sla 45`;
  if (rest.length === 0) return fail("'sla' needs a number of minutes", example);
  if (rest.length > 1) return fail("'sla' takes one number", example);
  const token = (rest[0] ?? '').trim();
  if (/^[+-]?\d+$/.test(token)) {
    const minutes = Number(token);
    if (minutes < SLA_MIN_MINUTES) return fail(`sla needs at least ${SLA_MIN_MINUTES}m`, SLA_HINT);
    if (minutes > SLA_MAX_MINUTES) return fail(`sla caps at ${SLA_MAX_MINUTES}m (24h)`, SLA_HINT);
    return ok({ kind: 'sla', minutes }, `sla=${minutes}m`);
  }
  if (/^[+-]?\d*\.\d+$/.test(token)) {
    const whole = `sla needs whole minutes, ${SLA_MIN_MINUTES}-${SLA_MAX_MINUTES}`;
    return fail(whole, 'drop the decimal: sla 45');
  }
  return fail(`'${token}' is not a number`, example);
}

function parseScanlines(rest: readonly string[]): CommandResult {
  if (rest.length === 0) return fail("'scanlines' needs on, off or toggle", SCANLINE_HINT);
  if (rest.length > 1) return fail("'scanlines' takes one mode", SCANLINE_HINT);
  const value = (rest[0] ?? '').trim().toLowerCase();
  const mode = oneOf(value, SCANLINE_MODES);
  if (mode === undefined) return fail(`unknown scanlines mode '${value}'`, SCANLINE_HINT);
  return ok({ kind: 'scanlines', value: mode }, `scanlines=${mode}`);
}

function parseGoto(rest: readonly string[]): CommandResult {
  if (rest.length === 0) return fail("'goto' needs a pane", PANE_HINT);
  if (rest.length > 1) return fail("'goto' takes one pane", PANE_HINT);
  const value = (rest[0] ?? '').trim();
  const pane = PANE_ALIASES[value.toLowerCase()];
  if (pane === undefined) return fail(`unknown pane '${value}'`, PANE_HINT);
  return ok({ kind: 'goto', pane }, `goto=${pane}`);
}

function parseUnknown(verb: string): CommandResult {
  const near = nearestVerbs(verb, tolerance(verb));
  const hint =
    near.length > 0 ? `did you mean '${near[0] ?? verb}'?` : `commands: ${VERBS.join(', ')}`;
  return fail(`unknown command '${verb}'`, hint);
}

/**
 * Parses one command bar line.
 *
 * An empty or whitespace-only line is deliberately **not** an error: Enter on
 * an untouched bar returns `clear`, so the operator always has a route back to
 * a blank slate. Errors carry `message` (what went wrong) and `hint` (what to
 * type instead), and no input makes this throw.
 */
export function parseCommand(raw: string, ctx?: CommandContext): CommandResult {
  const text = (typeof raw === 'string' ? raw : '').trim();
  if (text.length === 0) return ok({ kind: 'clear' }, CLEARED_ECHO);
  const tokens = text.split(/\s+/);
  const verb = (tokens[0] ?? '').toLowerCase();
  const rest = tokens.slice(1);
  if (verb === 'filter') return parseFilter(rest, ctx);
  if (verb === 'sort') return parseSort(rest);
  if (verb === 'owner') return parseOwner(rest, ctx);
  if (verb === 'sla') return parseSla(rest);
  if (verb === 'search') {
    const value = rest.join(' ').trim();
    return ok({ kind: 'search', value }, value.length === 0 ? 'search cleared' : `search=${value}`);
  }
  if (verb === 'scanlines') return parseScanlines(rest);
  if (verb === 'clear') {
    if (rest.length > 0)
      return fail("'clear' takes no arguments", 'clear resets filters, sort and search');
    return ok({ kind: 'clear' }, CLEARED_ECHO);
  }
  if (verb === 'goto') return parseGoto(rest);
  if (verb === 'help') {
    if (rest.length > 0) return fail("'help' takes no arguments", 'type help on its own');
    return ok({ kind: 'help' }, 'help opened');
  }
  return parseUnknown(verb);
}

/** Dedupe, then cap the autocomplete hint list. */
function cap(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/** Full command strings a verb expands into, most likely values first. */
function verbCandidates(verb: string, ctx: CommandContext | undefined): string[] {
  if (verb === 'filter') {
    const stages = STAGE_VALUES.map((v) => `filter stage=${v}`);
    const states = STATE_VALUES.map((v) => `filter state=${v}`);
    const team = ['filter owner=unassigned', 'filter owner=all'];
    const ads = ['filter source=all', ...listOf(ctx?.sources).map((s) => `filter source=${s}`)];
    return [
      ...stages,
      ...states,
      ...team,
      ...listOf(ctx?.owners).map((o) => `filter owner=${o}`),
      ...ads,
    ];
  }
  if (verb === 'sort') return SORT_FIELDS.map((field) => `sort ${field}`);
  if (verb === 'owner')
    return listOf(ctx?.owners)
      .map((name) => `owner ${name}`)
      .concat('owner ');
  if (verb === 'sla') return ['sla 45'];
  if (verb === 'search') return ['search '];
  if (verb === 'scanlines') return SCANLINE_MODES.map((mode) => `scanlines ${mode}`);
  if (verb === 'goto')
    return [...PANE_IDS.map((p) => `goto ${p}`), 'goto q', 'goto f', 'goto s', 'goto r'];
  if (verb === 'clear') return ['clear'];
  if (verb === 'help') return ['help'];
  return [];
}

/** Splits `source=x` into `{ key: 'source', value: 'x' }`. */
function splitSlot(slot: string): { key: string; value: string } {
  const cut = firstSeparator(slot);
  return cut < 0
    ? { key: '', value: slot }
    : { key: slot.slice(0, cut), value: slot.slice(cut + 1) };
}

/**
 * Autocomplete hints for a partially typed line, best first, capped at 8.
 *
 * Matching is case-insensitive and tries prefix before substring before edit
 * distance. A partial that matches nothing returns `[]` rather than throwing.
 */
export function suggestCommands(partial: string, ctx?: CommandContext): string[] {
  const raw = typeof partial === 'string' ? partial : '';
  if (raw.trim().length === 0) return cap(STARTING_COMMANDS);
  const tokens = raw.trim().split(/\s+/);
  const verb = (tokens[0] ?? '').toLowerCase();
  if (tokens.length > 1 && VERBS.includes(verb)) {
    const typed = splitSlot((tokens[tokens.length - 1] ?? '').toLowerCase());
    const fits = (item: string, by: (value: string, want: string) => boolean): boolean => {
      const slot = splitSlot(item.slice(verb.length + 1).toLowerCase());
      if (typed.key.length === 0) return slot.key === '' && by(slot.value, typed.value);
      if (slot.key !== typed.key) return false;
      return typed.value.length === 0 || by(slot.value, typed.value);
    };
    const all = verbCandidates(verb, ctx);
    const starts = all.filter((item) => fits(item, (v, w) => v.startsWith(w)));
    if (starts.length > 0) return cap(starts);
    return cap(all.filter((item) => fits(item, (v, w) => v.includes(w))));
  }
  const starts = VERBS.filter((item) => item.startsWith(verb));
  if (starts.length > 0) return cap(starts.flatMap((item) => verbCandidates(item, ctx)));
  const inside = VERBS.filter((item) => !item.startsWith(verb) && item.includes(verb));
  if (inside.length > 0) return cap(inside.flatMap((item) => verbCandidates(item, ctx)));
  const near = nearestVerbs(verb, tolerance(verb));
  return cap(near.flatMap((item) => verbCandidates(item, ctx)));
}
