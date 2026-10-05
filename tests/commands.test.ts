import { describe, it, expect } from 'vitest';
import { COMMAND_HELP, parseCommand, suggestCommands } from '@/lib/commands';
import type { CommandContext, CommandErr, CommandIntent, CommandOk } from '@/lib/commands';

/** A loaded console: five sellers and the six ads the seed data runs. */
const ctx: CommandContext = {
  owners: ['Priya Sharma', 'Rahul Verma', 'Ananya Iyer', 'Vikram Rao', 'Sneha Kulkarni'],
  sources: [
    'CTWA-Diwali-Offer',
    'CTWA-Republic-Day-Sale',
    'CTWA-Same-Day-Install',
    'CTWA-Loan-EMI-0',
    'CTWA-Free-Demo-Request',
    'CTWA-Referral-Cashback',
  ],
};

/** Verbs the parser dispatches on; mirrors `lib/commands.ts`. */
const VERBS = ['filter', 'sort', 'owner', 'sla', 'search', 'scanlines', 'clear', 'goto', 'help'];

/** Inputs chosen to break a naive tokenizer. No one of them may throw. */
const JUNK_INPUTS: readonly string[] = [
  '',
  ' ',
  '\t',
  '\n',
  '\r\n',
  '=',
  '===',
  ':::',
  ':=',
  '?',
  '???',
  '.',
  '...',
  '-',
  '--',
  '+',
  '%',
  'filter',
  'sla',
  'sort',
  'owner',
  'search',
  'scanlines',
  'goto',
  'clear',
  'help',
  'filter=',
  'filter:',
  'filter =',
  'filter stage',
  'filter stage=',
  'filter =new',
  'FILTER STAGE=',
  'filter owner=',
  'filter owner=a=b',
  'filter stage=new state=ok',
  'sla 45 60',
  'sla -',
  'sla +',
  'sla --',
  'sla .',
  'goto ',
  'sort  ',
  'a=b=c',
  'x'.repeat(200),
  '\u00e9'.repeat(200),
  '  x  '.repeat(50),
];

/** Inputs that must all be rejected, for the error voice sweep. */
const ERROR_INPUTS: readonly string[] = [
  'filter',
  'filter=',
  'filter stage',
  'filter stage=',
  'filter nokey=new',
  'filter stage=won',
  'filter state=meh',
  'filter owner=Nobody Here',
  'filter source=Nope',
  'filter stage=new state=ok',
  'sort',
  'sort nope',
  'sort wait extra',
  'owner',
  'owner unassigned',
  'owner Nobody Here',
  'sla',
  'sla 0',
  'sla 1',
  'sla 45.5',
  'sla 45m',
  'sla 99999',
  'sla 45 60',
  'scanlines',
  'scanlines maybe',
  'scanlines on off',
  'goto',
  'goto x',
  'goto q f',
  'clear now',
  'help now',
  'qqqqqqqqqq',
  'Wibble',
];

/** Asserts a line parsed, and hands back the whole ok result. */
function okOf(raw: string, context: CommandContext | undefined = ctx): CommandOk {
  const result = parseCommand(raw, context);
  if (!result.ok) throw new Error(`expected '${raw}' to parse, got error: ${result.message}`);
  return result;
}

/** Asserts a line parsed, and hands back just the intent. */
function intentOf(raw: string, context: CommandContext | undefined = ctx): CommandIntent {
  return okOf(raw, context).intent;
}

/** Asserts a line was rejected, and hands back the error. */
function errOf(raw: string, context: CommandContext | undefined = ctx): CommandErr {
  const result = parseCommand(raw, context);
  if (result.ok) throw new Error(`expected '${raw}' to fail, got intent '${result.intent.kind}'`);
  return result;
}

/** Narrows an intent to the filter variant so `field` and `value` are typed. */
function filterOf(
  raw: string,
  context: CommandContext | undefined = ctx,
): {
  kind: 'filter';
  field: 'stage' | 'source' | 'owner' | 'state';
  value: string;
} {
  const intent = intentOf(raw, context);
  if (intent.kind !== 'filter') {
    throw new Error(`expected a filter intent from '${raw}', got '${intent.kind}'`);
  }
  return intent;
}

/** Narrows an intent to the sla variant so `minutes` is typed as a number. */
function slaOf(raw: string): { kind: 'sla'; minutes: number } {
  const intent = intentOf(raw);
  if (intent.kind !== 'sla') {
    throw new Error(`expected an sla intent from '${raw}', got '${intent.kind}'`);
  }
  return intent;
}

describe('parseCommand', () => {
  describe('the commands from the brief', () => {
    it('parses filter stage=new', () => {
      expect(intentOf('filter stage=new')).toEqual({
        kind: 'filter',
        field: 'stage',
        value: 'new',
      });
    });

    it('parses sort wait', () => {
      expect(intentOf('sort wait')).toEqual({ kind: 'sort', field: 'wait' });
    });

    it('parses owner priya to the canonical full name', () => {
      expect(intentOf('owner priya')).toEqual({ kind: 'owner', value: 'Priya Sharma' });
    });

    it('parses sla 45 with a numeric minute count', () => {
      const intent = slaOf('sla 45');
      expect(intent.minutes).toBe(45);
      expect(typeof intent.minutes).toBe('number');
    });

    it('parses help', () => {
      expect(intentOf('help')).toEqual({ kind: 'help' });
    });
  });

  describe('echo text', () => {
    it('echoes the normalised command so the console can render it back', () => {
      expect(okOf('filter stage=new').echo).toBe('stage=new');
      expect(okOf('sort WAIT').echo).toBe('sort=wait');
      expect(okOf('sla 45').echo).toBe('sla=45m');
      expect(okOf('owner priya').echo).toBe('owner=Priya Sharma');
      expect(okOf('goto q').echo).toBe('goto=queue');
      expect(okOf('scanlines ON').echo).toBe('scanlines=on');
      expect(okOf('search priya').echo).toBe('search=priya');
      expect(okOf('help').echo).toBe('help opened');
    });
  });

  describe('normalisation', () => {
    it('is case insensitive and collapses runs of whitespace', () => {
      expect(intentOf('  SORT   WAIT  ')).toEqual({ kind: 'sort', field: 'wait' });
      expect(intentOf('FILTER STAGE=NEW')).toEqual({
        kind: 'filter',
        field: 'stage',
        value: 'new',
      });
    });

    it('treats : and = as interchangeable separators', () => {
      expect(intentOf('filter state:breach')).toEqual({
        kind: 'filter',
        field: 'state',
        value: 'breach',
      });
      expect(intentOf('filter state=breach')).toEqual({
        kind: 'filter',
        field: 'state',
        value: 'breach',
      });
    });

    it('accepts either separator for a multi word value', () => {
      expect(filterOf('filter owner:vikram rao').value).toBe('Vikram Rao');
    });
  });

  describe('sla validation', () => {
    it('accepts the whole legal range as whole minutes', () => {
      expect(slaOf('sla 2').minutes).toBe(2);
      expect(slaOf('sla 45').minutes).toBe(45);
      expect(slaOf('sla 1440').minutes).toBe(1440);
      expect(typeof slaOf('sla 45').minutes).toBe('number');
    });

    it('rejects a value below the two minute floor', () => {
      expect(errOf('sla 0').message).toBe('sla needs at least 2m');
      expect(errOf('sla 1').message).toBe('sla needs at least 2m');
      expect(errOf('sla -45').message).toBe('sla needs at least 2m');
    });

    it('rejects a fractional minute count and says how to fix it', () => {
      const err = errOf('sla 45.5');
      expect(err.message).toBe('sla needs whole minutes, 2-1440');
      expect(err.hint).toBe('drop the decimal: sla 45');
    });

    it('rejects a value above the 24 hour cap', () => {
      expect(errOf('sla 99999').message).toBe('sla caps at 1440m (24h)');
    });

    it('rejects a non numeric argument by naming it', () => {
      expect(errOf('sla abc').message).toBe("'abc' is not a number");
      expect(errOf('sla 45m').message).toBe("'45m' is not a number");
    });

    it('rejects two arguments', () => {
      expect(errOf('sla 45 60').message).toBe("'sla' takes one number");
    });

    it('asks for a number when the argument is missing', () => {
      expect(errOf('sla').message).toBe("'sla' needs a number of minutes");
    });

    it('quotes the accepted range in the hint of every range error', () => {
      for (const raw of ['sla', 'sla 0', 'sla 1', 'sla abc', 'sla 99999', 'sla 45 60']) {
        expect(errOf(raw).hint).toContain('2-1440');
      }
    });
  });

  describe('value validation quotes the legal set in the hint', () => {
    it('lists every stage when the stage is unknown', () => {
      const err = errOf('filter stage=won');
      expect(err.message).toBe("unknown stage 'won'");
      for (const stage of ['new', 'talks', 'negotiation', 'closed', 'all']) {
        expect(err.hint).toContain(stage);
      }
    });

    it('lists every state when the state is unknown', () => {
      const err = errOf('filter state=meh');
      expect(err.message).toBe("unknown state 'meh'");
      for (const state of ['ok', 'warn', 'breach', 'all']) {
        expect(err.hint).toContain(state);
      }
    });

    it('lists every sort field when the sort field is unknown', () => {
      const err = errOf('sort nope');
      expect(err.message).toBe("unknown sort field 'nope'");
      for (const field of ['wait', 'created', 'amount', 'name']) {
        expect(err.hint).toContain(field);
      }
    });

    it('lists every pane when the pane is unknown', () => {
      const err = errOf('goto x');
      expect(err.message).toBe("unknown pane 'x'");
      for (const pane of ['queue', 'funnel', 'sources', 'response']) {
        expect(err.hint).toContain(pane);
      }
    });

    it('accepts each legal stage', () => {
      for (const stage of ['new', 'talks', 'negotiation', 'closed']) {
        expect(filterOf(`filter stage=${stage}`).value).toBe(stage);
      }
    });

    it('accepts each legal state', () => {
      for (const state of ['ok', 'warn', 'breach']) {
        expect(filterOf(`filter state=${state}`).value).toBe(state);
      }
    });

    it('accepts each legal sort field', () => {
      for (const field of ['wait', 'created', 'amount', 'name']) {
        expect(intentOf(`sort ${field}`)).toEqual({ kind: 'sort', field });
      }
    });

    it('accepts each legal pane, by full name and by single letter', () => {
      for (const pane of ['queue', 'funnel', 'sources', 'response']) {
        expect(intentOf(`goto ${pane}`)).toEqual({ kind: 'goto', pane });
      }
      expect(intentOf('goto q')).toEqual({ kind: 'goto', pane: 'queue' });
      expect(intentOf('goto f')).toEqual({ kind: 'goto', pane: 'funnel' });
      expect(intentOf('goto s')).toEqual({ kind: 'goto', pane: 'sources' });
      expect(intentOf('goto r')).toEqual({ kind: 'goto', pane: 'response' });
    });

    it('accepts each legal scanline mode', () => {
      for (const mode of ['on', 'off', 'toggle']) {
        expect(intentOf(`scanlines ${mode}`)).toEqual({ kind: 'scanlines', value: mode });
      }
    });

    it('rejects an unknown scanline mode', () => {
      expect(errOf('scanlines maybe').message).toBe("unknown scanlines mode 'maybe'");
      expect(errOf('scanlines maybe').hint).toBe('scanlines on|off|toggle');
    });
  });

  describe('multi word filter values', () => {
    it('resolves filter owner=Vikram Rao to the canonical full name', () => {
      const intent = filterOf('filter owner=Vikram Rao');
      expect(intent.field).toBe('owner');
      expect(intent.value).toBe('Vikram Rao');
    });

    it('accepts a first name, initials or a substring as well as the full name', () => {
      expect(filterOf('filter owner=priya').value).toBe('Priya Sharma');
      expect(filterOf('filter owner=ps').value).toBe('Priya Sharma');
      expect(filterOf('filter owner=verm').value).toBe('Rahul Verma');
      expect(filterOf('filter owner=VIKRAM RAO').value).toBe('Vikram Rao');
    });

    it('refuses two key=value pairs on one line', () => {
      expect(errOf('filter stage=new state=ok').message).toBe(
        "'filter' takes one key=value, got two",
      );
    });

    it('reports an unknown owner, listing the real team in the hint', () => {
      const err = errOf('filter owner=Nobody Here');
      expect(err.message).toBe("no team member matches 'Nobody Here'");
      expect(err.hint).toContain('Priya Sharma');
      expect(err.hint).toContain('Sneha Kulkarni');
    });

    it('reports an unknown ad against the ad list, not the owner list', () => {
      const err = errOf('filter source=Nope');
      expect(err.message).toBe("no ad matches 'Nope'");
      expect(err.hint).toContain('CTWA-Diwali-Offer');
    });

    it('resolves a source name to the exact ad string from the console', () => {
      expect(filterOf('filter source=ctwa-loan-emi-0').value).toBe('CTWA-Loan-EMI-0');
      expect(filterOf('filter source=ctwa-referral-cashback').value).toBe('CTWA-Referral-Cashback');
    });

    it('rejects a filter token with no separator at all', () => {
      expect(errOf('filter stage').message).toBe("'stage' is not a filter field");
    });

    it('rejects an unknown filter axis by name', () => {
      const err = errOf('filter nokey=new');
      expect(err.message).toBe("unknown filter 'nokey'");
      expect(err.hint).toBe('filters: stage, state, owner, source');
    });

    it('rejects a filter with an empty value', () => {
      expect(errOf('filter stage=').message).toBe('filter stage= has no value');
      expect(errOf('filter stage=').hint).toContain('new');
    });
  });

  describe('owner and unassigned', () => {
    it('refuses unassigned as an assignment and points at the filter that lists them', () => {
      const err = errOf('owner unassigned');
      expect(err.message).toBe("'unassigned' is not a person");
      expect(err.hint).toContain('filter owner=unassigned');
    });

    it('accepts filter owner=unassigned, which is a filter not an assignment', () => {
      expect(filterOf('filter owner=unassigned').value).toBe('unassigned');
    });

    it('accepts all on every axis to clear the filter', () => {
      expect(filterOf('filter owner=all').value).toBe('all');
      expect(filterOf('filter stage=all').value).toBe('all');
      expect(filterOf('filter state=all').value).toBe('all');
      expect(filterOf('filter source=all').value).toBe('all');
    });

    it('assigns the lead to a resolved full name', () => {
      expect(intentOf('owner sneha')).toEqual({ kind: 'owner', value: 'Sneha Kulkarni' });
      expect(intentOf('owner  vikram   rao  ')).toEqual({
        kind: 'owner',
        value: 'Vikram Rao',
      });
    });

    it('asks for a name when the owner argument is missing', () => {
      expect(errOf('owner').message).toBe("'owner' needs a name");
    });
  });

  describe('verbs that take no arguments', () => {
    it('rejects help with an argument', () => {
      const err = errOf('help now');
      expect(err.message).toBe("'help' takes no arguments");
      expect(err.hint).toBe('type help on its own');
    });

    it('rejects clear with an argument', () => {
      const err = errOf('clear now');
      expect(err.message).toBe("'clear' takes no arguments");
      expect(err.hint).toBe('clear resets filters, sort and search');
    });

    it('accepts both on their own', () => {
      expect(intentOf('help')).toEqual({ kind: 'help' });
      expect(intentOf('clear')).toEqual({ kind: 'clear' });
    });
  });

  describe('search and sort', () => {
    it('keeps the whole search phrase as one value', () => {
      expect(intentOf('search anil kumar')).toEqual({
        kind: 'search',
        value: 'anil kumar',
      });
    });

    it('reports an empty search as cleared rather than as a no-op', () => {
      expect(intentOf('search')).toEqual({ kind: 'search', value: '' });
      expect(okOf('search').echo).toBe('search cleared');
    });

    it('asks for a field when sort has no argument', () => {
      expect(errOf('sort').message).toBe("'sort' needs a field");
    });

    it('rejects two sort fields', () => {
      expect(errOf('sort wait name').message).toBe("'sort' takes one field");
    });
  });

  describe('unknown verbs', () => {
    it('suggests the nearest verb for a one letter slip', () => {
      expect(errOf('slae 45').hint).toBe("did you mean 'sla'?");
      expect(errOf('slae 45').message).toBe("unknown command 'slae'");
    });

    it('suggests the nearest verb for a transposed sort', () => {
      expect(errOf('srot wait').hint).toBe("did you mean 'sort'?");
    });

    it('falls back to the full verb list when nothing is close', () => {
      const err = errOf('qqqqqqqqqq');
      expect(err.message).toBe("unknown command 'qqqqqqqqqq'");
      expect(err.hint).toContain('filter');
      expect(err.hint).toContain('scanlines');
    });

    it('lowercases the unknown verb it quotes back', () => {
      expect(errOf('Wibble').message).toBe("unknown command 'wibble'");
    });

    it('ignores trailing junk after an unknown verb', () => {
      expect(errOf('qqqqqqqqqq 45 extra').message).toBe("unknown command 'qqqqqqqqqq'");
    });
  });

  describe('empty input', () => {
    it('treats Enter on an untouched bar as a reset, not as an error', () => {
      // Deliberate: the operator must always have a route back to a blank
      // slate, so an empty or whitespace-only line is a valid clear.
      expect(intentOf('')).toEqual({ kind: 'clear' });
      expect(intentOf('   ')).toEqual({ kind: 'clear' });
      expect(intentOf('\t\n ')).toEqual({ kind: 'clear' });
    });

    it('echoes the same confirmation as an explicit clear', () => {
      expect(okOf('').echo).toBe('filters cleared');
      expect(okOf('   ').echo).toBe('filters cleared');
      expect(okOf('clear').echo).toBe('filters cleared');
    });
  });

  describe('error voice', () => {
    it('gives every rejection a non-empty message and a non-empty hint', () => {
      for (const raw of ERROR_INPUTS) {
        const err = errOf(raw);
        expect(err.ok).toBe(false);
        expect(err.message.trim().length).toBeGreaterThan(0);
        expect(err.hint.trim().length).toBeGreaterThan(0);
      }
    });

    it('never apologises or blames the operator', () => {
      for (const raw of ERROR_INPUTS) {
        const err = errOf(raw);
        expect(err.message).not.toMatch(/sorry|oops|unfortunately/i);
        expect(err.hint).not.toMatch(/sorry|oops|unfortunately/i);
      }
    });

    it('keeps every error to a single line, for the one-line error slot', () => {
      for (const raw of ERROR_INPUTS) {
        const err = errOf(raw);
        expect(err.message).not.toContain('\n');
        expect(err.hint).not.toContain('\n');
      }
    });

    it('gives every rejection a hint that is actionable, not a restatement', () => {
      for (const raw of ERROR_INPUTS) {
        const err = errOf(raw);
        expect(err.hint).not.toBe(err.message);
      }
    });
  });

  describe('console context', () => {
    it('passes a name through unchanged when no console context is supplied', () => {
      // `parseCommand` is called with the context genuinely absent rather than
      // with an empty object: the helpers above default their second argument
      // to the loaded console, so passing `undefined` would reintroduce it.
      const bareOwner = parseCommand('owner whoever');
      const bareFilter = parseCommand('filter owner=whoever');
      if (!bareOwner.ok) throw new Error(`owner should parse: ${bareOwner.message}`);
      if (!bareFilter.ok) throw new Error(`filter should parse: ${bareFilter.message}`);
      expect(bareOwner.intent).toEqual({ kind: 'owner', value: 'whoever' });
      if (bareFilter.intent.kind !== 'filter') {
        throw new Error(`expected a filter intent, got '${bareFilter.intent.kind}'`);
      }
      expect(bareFilter.intent.value).toBe('whoever');
    });

    it('says so when the team has not loaded yet', () => {
      const empty: CommandContext = { owners: [], sources: [] };
      const err = errOf('filter owner=', empty);
      expect(err.message).toBe('filter owner= has no value');
      expect(err.hint).toBe('owners: none loaded');
    });

    it('passes a name through when the loaded team is empty', () => {
      const empty: CommandContext = { owners: [], sources: [] };
      expect(intentOf('owner priya', empty)).toEqual({ kind: 'owner', value: 'priya' });
    });
  });

  describe('never throwing', () => {
    it.each(JUNK_INPUTS)('parseCommand does not throw on %j', (raw) => {
      const result = parseCommand(raw, ctx);
      expect(typeof result.ok).toBe('boolean');
    });

    it('returns a usable result object for every junk input', () => {
      for (const raw of JUNK_INPUTS) {
        const result = parseCommand(raw, ctx);
        expect(result).toBeDefined();
        if (result.ok) {
          expect(result.echo.length).toBeGreaterThan(0);
        } else {
          expect(result.message.length).toBeGreaterThan(0);
          expect(result.hint.length).toBeGreaterThan(0);
        }
      }
    });

    it('never throws with no context supplied at all', () => {
      for (const raw of JUNK_INPUTS) {
        expect(() => parseCommand(raw)).not.toThrow();
        expect(() => parseCommand(raw, undefined)).not.toThrow();
      }
    });
  });
});

describe('suggestCommands', () => {
  it('expands a partial verb into concrete commands', () => {
    const suggestions = suggestCommands('fil', ctx);
    expect(suggestions).toContain('filter stage=new');
  });

  it('caps every list at eight entries', () => {
    expect(suggestCommands('fil', ctx)).toHaveLength(8);
    expect(suggestCommands('f', ctx).length).toBeLessThanOrEqual(8);
    expect(suggestCommands('owner', ctx).length).toBeLessThanOrEqual(8);
    expect(suggestCommands('filter source=', ctx).length).toBeLessThanOrEqual(8);
  });

  it('suggests the starting commands for an empty line, at most eight of them', () => {
    const suggestions = suggestCommands('', ctx);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(8);
    expect(suggestions).toContain('help');
    expect(suggestions).toContain('filter stage=');
    expect(suggestions).toContain('sla 45');
  });

  it('treats a whitespace only line like an empty one', () => {
    expect(suggestCommands('   ')).toEqual(suggestCommands(''));
  });

  it('surfaces the real owner full names once an owner filter is being typed', () => {
    const suggestions = suggestCommands('filter owner=', ctx);
    expect(suggestions).toContain('filter owner=Priya Sharma');
    expect(suggestions).toContain('filter owner=Vikram Rao');
    expect(suggestions).toContain('filter owner=unassigned');
    expect(suggestions).toContain('filter owner=all');
  });

  it('narrows further as more of the owner name is typed', () => {
    expect(suggestCommands('filter owner=vi', ctx)).toEqual(['filter owner=Vikram Rao']);
  });

  it('matches a typed owner name case-insensitively', () => {
    expect(suggestCommands('FILTER OWNER=PR', ctx)).toEqual(['filter owner=Priya Sharma']);
  });

  it('surfaces the real ad names once a source filter is being typed', () => {
    const suggestions = suggestCommands('filter source=', ctx);
    expect(suggestions).toContain('filter source=CTWA-Loan-EMI-0');
    expect(suggestions).toContain('filter source=CTWA-Referral-Cashback');
  });

  it('expands the owner verb into one suggestion per seller', () => {
    const suggestions = suggestCommands('owner', ctx);
    expect(suggestions).toContain('owner Priya Sharma');
    expect(suggestions).toContain('owner Sneha Kulkarni');
  });

  it('expands every sort field and scanline mode', () => {
    expect(suggestCommands('sort', ctx)).toEqual([
      'sort wait',
      'sort created',
      'sort amount',
      'sort name',
    ]);
    expect(suggestCommands('scanlines', ctx)).toEqual([
      'scanlines on',
      'scanlines off',
      'scanlines toggle',
    ]);
  });

  it('returns an empty list for a partial that matches nothing', () => {
    expect(suggestCommands('zzz')).toEqual([]);
    expect(suggestCommands('zzz', ctx)).toEqual([]);
  });

  it('recovers from a mistyped verb by edit distance', () => {
    expect(suggestCommands('hlp')).toEqual(['help']);
  });

  it('never throws, whatever it is handed', () => {
    for (const raw of JUNK_INPUTS) {
      const suggestions = suggestCommands(raw, ctx);
      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeLessThanOrEqual(8);
      for (const item of suggestions) {
        expect(typeof item).toBe('string');
        expect(item.length).toBeGreaterThan(0);
      }
    }
  });

  it('never returns the same suggestion twice', () => {
    for (const raw of ['f', 'filter', 'filter owner=', 'owner', 'sort', 'goto', '']) {
      const suggestions = suggestCommands(raw, ctx);
      expect(new Set(suggestions).size).toBe(suggestions.length);
    }
  });
});

describe('COMMAND_HELP', () => {
  it('documents twelve commands, one row per supported command', () => {
    // Twelve rows: help, the four filter axes, sort, sla, owner, search, goto,
    // scanlines and clear. Any other count means help and the parser disagree.
    expect(COMMAND_HELP).toHaveLength(12);
  });

  it('gives every row a usage line and a one line summary', () => {
    for (const entry of COMMAND_HELP) {
      expect(entry.usage.trim().length).toBeGreaterThan(0);
      expect(entry.summary.trim().length).toBeGreaterThan(0);
      expect(entry.usage).not.toContain('\n');
      expect(entry.summary).not.toContain('\n');
    }
  });

  it('starts every usage line with a verb the parser actually dispatches', () => {
    for (const entry of COMMAND_HELP) {
      const verb = entry.usage.split(/\s+/)[0];
      expect(verb).toBeDefined();
      expect(VERBS).toContain(verb ?? '');
    }
  });

  it('documents all four filter axes', () => {
    const usages = COMMAND_HELP.map((entry) => entry.usage);
    for (const field of ['stage', 'state', 'owner', 'source']) {
      expect(usages.some((usage) => usage.startsWith(`filter ${field}=`))).toBe(true);
    }
  });

  it('documents the goto pane letters and the sla range', () => {
    const usages = COMMAND_HELP.map((entry) => entry.usage);
    expect(usages).toContain('goto q|f|s|r');
    expect(usages).toContain('sla <minutes>');
    expect(COMMAND_HELP.find((entry) => entry.usage === 'sla <minutes>')?.summary).toContain(
      '2-1440',
    );
  });

  it('documents every sort field and scanline mode', () => {
    const usages = COMMAND_HELP.map((entry) => entry.usage);
    expect(usages).toContain('sort wait|created|amount|name');
    expect(usages).toContain('scanlines on|off|toggle');
  });

  it('has help and clear as the only bare verbs, and both parse on their own', () => {
    const bare = COMMAND_HELP.filter((entry) => !entry.usage.includes(' ')).map(
      (entry) => entry.usage,
    );
    expect(bare).toEqual(['help', 'clear']);
    for (const usage of bare) {
      expect(parseCommand(usage, ctx).ok).toBe(true);
    }
  });

  it('has no duplicate usage lines', () => {
    const usages = COMMAND_HELP.map((entry) => entry.usage);
    expect(new Set(usages).size).toBe(usages.length);
  });
});
