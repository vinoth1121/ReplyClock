'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type {
  FunnelStage,
  Lead,
  LeadFilter,
  LeadsPayload,
  PaneId,
  ResponsePoint,
  SortField,
  SourceStat,
  Stage,
  StatsPayload,
  TeamMember,
} from '@/types';
import { STAGE_ORDER } from '@/types';
import {
  DEFAULT_SLA_MINUTES,
  filterLeads,
  isBreached,
  sortLeads,
  summarise,
  thresholdsFor,
} from '@/lib/sla';
import type { SlaThresholds } from '@/lib/sla';
import { parseCommand, suggestCommands } from '@/lib/commands';
import type { CommandContext, FilterField } from '@/lib/commands';
import { StatusBar } from '@/components/panes/StatusBar';
import { LeadQueue } from '@/components/panes/LeadQueue';
import { FunnelPane } from '@/components/panes/FunnelPane';
import { SourcePane } from '@/components/panes/SourcePane';
import { ResponsePane } from '@/components/panes/ResponsePane';
import { LeadDrawer } from '@/components/drawer/LeadDrawer';
import { ReplyComposer } from '@/components/drawer/ReplyComposer';
import { InvoiceStub } from '@/components/drawer/InvoiceStub';
import { CommandBar } from '@/components/commandbar/CommandBar';
import type { CommandOutputLine } from '@/components/commandbar/CommandBar';
import { HelpOverlay } from '@/components/HelpOverlay';
import { readUrlState, useUrlSync } from '@/lib/useUrlState';

/** The single clock interval. No other component in the console owns a timer. */
const TICK_MS = 1000;

/** How long a `g` prefix stays armed for a pane jump. */
const CHORD_WINDOW_MS = 1200;

/** Hard cap on command output lines held in state. */
const MAX_OUTPUT_LINES = 30;

/** Upper bound on SLA announcements emitted per clock tick. */
const MAX_ANNOUNCEMENTS_PER_TICK = 3;

const DEFAULT_FILTER: LeadFilter = {
  stage: 'all',
  owner: 'all',
  state: 'all',
  source: 'all',
  query: '',
};

const SLA_STATES = ['ok', 'warn', 'breach'] as const;

const EMPTY_FUNNEL: FunnelStage[] = [];
const EMPTY_SOURCES: SourceStat[] = [];
const EMPTY_RESPONSE: ResponsePoint[] = [];

const PANE_TABS: readonly { id: PaneId; label: string; hint: string }[] = [
  { id: 'queue', label: 'queue', hint: 'g q' },
  { id: 'funnel', label: 'funnel', hint: 'g f' },
  { id: 'sources', label: 'sources', hint: 'g a' },
  { id: 'response', label: 'response', hint: 'g r' },
];

/** Pane jump keys, both after `g` and from the mobile tab bar's `g` hints. */
const PANE_BY_KEY: Readonly<Record<string, PaneId>> = {
  q: 'queue',
  f: 'funnel',
  s: 'sources',
  a: 'sources',
  r: 'response',
};

type ConsoleStatus = 'loading' | 'ready' | 'error';

interface ConsoleState {
  leads: Lead[];
  team: TeamMember[];
  sources: string[];
  stats: StatsPayload | null;
  selectedId: string | null;
  sort: SortField;
  filter: LeadFilter;
  slaMinutes: number;
  scanlines: boolean;
  helpOpen: boolean;
  drawerLeadId: string | null;
  composerLeadId: string | null;
  invoiceLeadId: string | null;
  activePane: PaneId;
  cmdValue: string;
  cmdOutput: readonly CommandOutputLine[];
  pendingChord: string | null;
  status: ConsoleStatus;
  error: string | null;
}

type ConsoleAction =
  | { type: 'SET_LOADING' }
  | { type: 'SET_ERROR'; message: string }
  | { type: 'SET_DATA'; leads: LeadsPayload; stats: StatsPayload }
  | { type: 'SELECT'; id: string | null }
  | { type: 'SET_STAGE'; id: string; stage: Stage; at: string; by: string }
  | { type: 'SET_OWNER'; id: string; ownerId: string | null }
  | { type: 'ADD_NOTE'; id: string; at: string; by: string; text: string }
  | { type: 'RECORD_REPLY'; id: string; at: string; messageId: string; text: string }
  | { type: 'CYCLE_STAGE'; id: string; at: string; by: string }
  | { type: 'SET_SORT'; sort: SortField }
  | { type: 'SET_FILTER'; filter: Partial<LeadFilter> }
  | { type: 'SET_SLA'; minutes: number }
  | { type: 'SET_SCANLINES'; on: boolean }
  | { type: 'TOGGLE_HELP' }
  | { type: 'SET_DRAWER'; id: string | null }
  | { type: 'SET_COMPOSER'; id: string | null }
  | { type: 'SET_INVOICE'; id: string | null }
  | { type: 'SET_ACTIVE_PANE'; pane: PaneId }
  | { type: 'SET_CMD_VALUE'; value: string }
  | { type: 'PUSH_OUTPUT'; line: CommandOutputLine }
  | { type: 'TRIM_OUTPUT' }
  | { type: 'SET_CHORD'; chord: string | null };

/** Immutable single-lead update. Every action routes through here. */
function patchLead(leads: Lead[], id: string, patch: (lead: Lead) => Lead): Lead[] {
  return leads.map((lead) => (lead.id === id ? patch(lead) : lead));
}

function consoleReducer(state: ConsoleState, action: ConsoleAction): ConsoleState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, status: 'loading', error: null };
    case 'SET_ERROR':
      return { ...state, status: 'error', error: action.message };
    case 'SET_DATA': {
      const seeded = Number.isFinite(action.stats.slaMinutes)
        ? action.stats.slaMinutes
        : DEFAULT_SLA_MINUTES;
      return {
        ...state,
        status: 'ready',
        error: null,
        leads: action.leads.leads,
        team: action.leads.team,
        sources: action.leads.sources,
        stats: action.stats,
        slaMinutes: seeded,
      };
    }
    case 'SELECT':
      return { ...state, selectedId: action.id };
    case 'SET_STAGE':
      return {
        ...state,
        leads: patchLead(state.leads, action.id, (lead) => ({
          ...lead,
          stage: action.stage,
          timeline: [...lead.timeline, { stage: action.stage, at: action.at, by: action.by }],
        })),
      };
    case 'SET_OWNER':
      return {
        ...state,
        leads: patchLead(state.leads, action.id, (lead) => ({ ...lead, ownerId: action.ownerId })),
      };
    case 'ADD_NOTE':
      return {
        ...state,
        leads: patchLead(state.leads, action.id, (lead) => ({
          ...lead,
          notes: [
            ...lead.notes,
            { id: `${lead.id}-n-${action.at}`, at: action.at, by: action.by, text: action.text },
          ],
        })),
      };
    case 'RECORD_REPLY':
      return {
        ...state,
        leads: patchLead(state.leads, action.id, (lead) => ({
          ...lead,
          // First reply wins: a second send must not move the recorded reply time,
          // because that is what the frozen wait timer is measured against.
          firstReplyAt: lead.firstReplyAt ?? action.at,
          transcript: [
            ...lead.transcript,
            { id: action.messageId, direction: 'out', at: action.at, text: action.text },
          ],
        })),
      };
    case 'CYCLE_STAGE':
      return {
        ...state,
        leads: patchLead(state.leads, action.id, (lead) => {
          const index = STAGE_ORDER.indexOf(lead.stage);
          // Clamped, not wrapped: `s` on a Closed lead is a no-op, it never
          // jumps back to New. Wrapping would silently re-open closed revenue.
          const nextStage = STAGE_ORDER[Math.min(index + 1, STAGE_ORDER.length - 1)];
          if (nextStage === undefined || nextStage === lead.stage) return lead;
          return {
            ...lead,
            stage: nextStage,
            timeline: [...lead.timeline, { stage: nextStage, at: action.at, by: action.by }],
          };
        }),
      };
    case 'SET_SORT':
      return { ...state, sort: action.sort };
    case 'SET_FILTER':
      return { ...state, filter: { ...state.filter, ...action.filter } };
    case 'SET_SLA':
      return { ...state, slaMinutes: action.minutes };
    case 'SET_SCANLINES':
      return { ...state, scanlines: action.on };
    case 'TOGGLE_HELP':
      return { ...state, helpOpen: !state.helpOpen };
    case 'SET_DRAWER':
      return { ...state, drawerLeadId: action.id };
    case 'SET_COMPOSER':
      return { ...state, composerLeadId: action.id };
    case 'SET_INVOICE':
      return { ...state, invoiceLeadId: action.id };
    case 'SET_ACTIVE_PANE':
      return { ...state, activePane: action.pane };
    case 'SET_CMD_VALUE':
      return { ...state, cmdValue: action.value };
    case 'PUSH_OUTPUT':
      return {
        ...state,
        cmdOutput: [...state.cmdOutput, action.line].slice(-MAX_OUTPUT_LINES),
      };
    case 'TRIM_OUTPUT':
      return { ...state, cmdOutput: state.cmdOutput.slice(-MAX_OUTPUT_LINES) };
    case 'SET_CHORD':
      return { ...state, pendingChord: action.chord };
    default:
      return state;
  }
}

const INITIAL_STATE: ConsoleState = {
  leads: [],
  team: [],
  sources: [],
  stats: null,
  selectedId: null,
  sort: 'wait',
  filter: DEFAULT_FILTER,
  slaMinutes: DEFAULT_SLA_MINUTES,
  scanlines: true,
  helpOpen: false,
  drawerLeadId: null,
  composerLeadId: null,
  invoiceLeadId: null,
  activePane: 'queue',
  cmdValue: '',
  cmdOutput: [],
  pendingChord: null,
  status: 'loading',
  error: null,
};

function getInitialState(): ConsoleState {
  if (typeof window === 'undefined') return INITIAL_STATE;
  const urlState = readUrlState(window.location.search);
  return {
    ...INITIAL_STATE,
    ...urlState,
    filter: { ...INITIAL_STATE.filter, ...(urlState.filter ?? {}) },
  };
}

/** Only safe inside an event handler or effect, never during render. */
function isoNow(): string {
  return new Date().toISOString();
}

/** Turns a validated parser filter value into a typed filter patch. */
function filterPatch(field: FilterField, value: string): Partial<LeadFilter> {
  if (field === 'stage') {
    const stage = STAGE_ORDER.find((item) => item === value);
    return { stage: stage ?? 'all' };
  }
  if (field === 'state') {
    const state = SLA_STATES.find((item) => item === value);
    return { state: state ?? 'all' };
  }
  if (field === 'owner') return { owner: value };
  return { source: value };
}

/** View slice the keydown listener reads, so it never needs re-binding. */
interface ViewSlice {
  sorted: Lead[];
  selectedId: string | null;
  composerLeadId: string | null;
  drawerLeadId: string | null;
  invoiceLeadId: string | null;
  helpOpen: boolean;
  pendingChord: string | null;
  now: number;
}

export default function ConsolePage(): JSX.Element {
  const [state, dispatch] = useReducer(consoleReducer, undefined, getInitialState);
  const [now, setNow] = useState(0);
  const [fetchKey, setFetchKey] = useState(0);
  const [liveMessage, setLiveMessage] = useState('');
  const cmdBarRef = useRef<HTMLDivElement | null>(null);
  const chordAtRef = useRef<number | null>(null);
  const suggestionIndexRef = useRef(0);
  const announcedRef = useRef<Set<string>>(new Set());
  const viewRef = useRef<ViewSlice>({
    sorted: [],
    selectedId: null,
    composerLeadId: null,
    drawerLeadId: null,
    invoiceLeadId: null,
    helpOpen: false,
    pendingChord: null,
    now: 0,
  });

  const clock = now > 0 ? now : 0;
  const ready = state.status === 'ready' && now > 0;

  /** 1. Data: both endpoints in parallel, one attempt per fetchKey. */
  useEffect(() => {
    let alive = true;
    dispatch({ type: 'SET_LOADING' });
    void (async () => {
      try {
        const [leadsResponse, statsResponse] = await Promise.all([
          fetch('/api/leads', { cache: 'no-store' }),
          fetch('/api/stats', { cache: 'no-store' }),
        ]);
        if (!leadsResponse.ok || !statsResponse.ok) {
          throw new Error(
            `api unreachable (leads ${leadsResponse.status} / stats ${statsResponse.status})`,
          );
        }
        const leadsPayload = (await leadsResponse.json()) as LeadsPayload;
        const statsPayload = (await statsResponse.json()) as StatsPayload;
        if (!alive) return;
        dispatch({ type: 'SET_DATA', leads: leadsPayload, stats: statsPayload });
      } catch (error) {
        if (!alive) return;
        const message = error instanceof Error ? error.message : 'network unreachable';
        dispatch({ type: 'SET_ERROR', message });
      }
    })();
    return () => {
      alive = false;
    };
  }, [fetchKey]);

  /** 2. The one and only timer. Children receive `now`, they never start one. */
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  /** 3 + 4. Derived selectors. Totals are recomputed client side on every
   *  mutation so the header reacts to a reply in the same render. */
  const thresholds: SlaThresholds = useMemo(
    () => thresholdsFor(state.slaMinutes),
    [state.slaMinutes],
  );
  const filtered = useMemo(
    () => filterLeads(state.leads, state.filter, clock, thresholds),
    [state.leads, state.filter, clock, thresholds],
  );
  const sorted = useMemo(
    () => sortLeads(filtered, state.sort, clock, thresholds),
    [filtered, state.sort, clock, thresholds],
  );
  const totals = useMemo(
    () => summarise(state.leads, clock, thresholds),
    [state.leads, clock, thresholds],
  );

  /** Keep the cursor inside the visible rows so j/k can never desync. */
  useEffect(() => {
    if (sorted.length === 0) {
      if (state.selectedId !== null) dispatch({ type: 'SELECT', id: null });
      return;
    }
    const present =
      state.selectedId !== null && sorted.some((lead) => lead.id === state.selectedId);
    if (present) return;
    const first = sorted[0];
    if (first !== undefined) dispatch({ type: 'SELECT', id: first.id });
  }, [sorted, state.selectedId]);

  /** Scanlines are pure chrome: one dataset flag on the root element. */
  useEffect(() => {
    const root = document.documentElement;
    if (state.scanlines) {
      root.dataset.scanlines = 'on';
    } else {
      delete root.dataset.scanlines;
    }
  }, [state.scanlines]);

  /** 5. Publish the view slice for the keyboard listener. */
  useEffect(() => {
    viewRef.current = {
      sorted,
      selectedId: state.selectedId,
      composerLeadId: state.composerLeadId,
      drawerLeadId: state.drawerLeadId,
      invoiceLeadId: state.invoiceLeadId,
      helpOpen: state.helpOpen,
      pendingChord: state.pendingChord,
      now: clock,
    };
  });

  /** 9. Sync the primary view state to the URL so a filtered or SLA-tuned
   *  view is a shareable link. */
  useUrlSync({
    slaMinutes: state.slaMinutes,
    sort: state.sort,
    filter: state.filter,
  });

  /** 8. Announce only newly breached leads, at most 3 per tick. */
  useEffect(() => {
    if (now === 0) return;
    const seen = announcedRef.current;
    const fresh: Lead[] = [];
    for (const lead of state.leads) {
      if (seen.has(lead.id)) continue;
      if (isBreached(lead, now, thresholds)) fresh.push(lead);
    }
    if (fresh.length === 0) return;
    const batch = fresh.slice(0, MAX_ANNOUNCEMENTS_PER_TICK);
    // Only the announced batch is marked, so the tail drains on later ticks
    // instead of being silently swallowed.
    for (const lead of batch) seen.add(lead.id);
    setLiveMessage(
      batch.map((lead) => `${lead.id} breached the ${state.slaMinutes} minute sla`).join('. '),
    );
  }, [now, state.leads, state.slaMinutes, thresholds]);

  const selectedLead: Lead | null = useMemo(() => {
    if (state.selectedId === null) return null;
    return state.leads.find((lead) => lead.id === state.selectedId) ?? null;
  }, [state.leads, state.selectedId]);

  const drawerLead: Lead | null = useMemo(
    () => findLead(state.leads, state.drawerLeadId),
    [state.leads, state.drawerLeadId],
  );
  const composerLead: Lead | null = useMemo(
    () => findLead(state.leads, state.composerLeadId),
    [state.leads, state.composerLeadId],
  );
  const invoiceLead: Lead | null = useMemo(
    () => findLead(state.leads, state.invoiceLeadId),
    [state.leads, state.invoiceLeadId],
  );

  /** 5. One window keydown listener for the whole console. */
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    function focusCommandInput(): boolean {
      const input = cmdBarRef.current?.querySelector<HTMLInputElement>('input');
      if (input === null || input === undefined) return false;
      input.focus();
      return true;
    }

    function move(delta: 1 | -1): boolean {
      const { sorted: rows, selectedId } = viewRef.current;
      if (rows.length === 0) return false;
      const index = rows.findIndex((lead) => lead.id === selectedId);
      const next =
        index < 0
          ? delta === 1
            ? 0
            : rows.length - 1
          : (index + delta + rows.length) % rows.length;
      const lead = rows[next];
      if (lead === undefined) return false;
      dispatch({ type: 'SELECT', id: lead.id });
      return true;
    }

    function onKeyDown(event: KeyboardEvent): void {
      const view = viewRef.current;
      const key = event.key;
      const typing = isTypingTarget(event.target);

      if (key === 'Escape') {
        if (typing) return;
        if (view.composerLeadId !== null) {
          dispatch({ type: 'SET_COMPOSER', id: null });
        } else if (view.drawerLeadId !== null) {
          dispatch({ type: 'SET_DRAWER', id: null });
        } else if (view.helpOpen) {
          dispatch({ type: 'TOGGLE_HELP' });
        } else if (view.invoiceLeadId !== null) {
          dispatch({ type: 'SET_INVOICE', id: null });
        } else {
          return;
        }
        event.preventDefault();
        return;
      }

      // Everything else yields to text entry, and the help overlay swallows the
      // console keys while it owns the screen.
      if (typing) return;
      if (view.helpOpen) return;

      // `g` chord. The window is measured, not timed: no second timer.
      const chordOpen =
        view.pendingChord === 'g' &&
        chordAtRef.current !== null &&
        view.now - chordAtRef.current <= CHORD_WINDOW_MS;
      if (chordOpen) {
        const pane = PANE_BY_KEY[key];
        if (pane !== undefined) {
          chordAtRef.current = null;
          dispatch({ type: 'SET_CHORD', chord: null });
          dispatch({ type: 'SET_ACTIVE_PANE', pane });
          event.preventDefault();
          return;
        }
      }
      if (view.pendingChord !== null) {
        chordAtRef.current = null;
        dispatch({ type: 'SET_CHORD', chord: null });
      }

      if (key === '/') {
        if (focusCommandInput()) event.preventDefault();
        return;
      }
      if (key === '?') {
        dispatch({ type: 'TOGGLE_HELP' });
        event.preventDefault();
        return;
      }
      if (key === 'g') {
        chordAtRef.current = view.now;
        dispatch({ type: 'SET_CHORD', chord: 'g' });
        event.preventDefault();
        return;
      }
      // j/k are intentionally handled here as well: LeadQueue consumes them
      // only when it has the focus and stops propagation in that case, so
      // double handling cannot happen. A focused queue owns the keys, an
      // unfocused one lets the shell move the selection, and the queue reads
      // `selectedId` either way, so both paths land on the same row.
      if (key === 'j' || key === 'ArrowDown') {
        if (move(1)) event.preventDefault();
        return;
      }
      if (key === 'k' || key === 'ArrowUp') {
        if (move(-1)) event.preventDefault();
        return;
      }
      if (view.selectedId === null) return;
      if (key === 'Enter') {
        dispatch({ type: 'SET_DRAWER', id: view.selectedId });
        dispatch({ type: 'SET_INVOICE', id: null });
        event.preventDefault();
        return;
      }
      if (key === 'r') {
        dispatch({ type: 'SET_COMPOSER', id: view.selectedId });
        event.preventDefault();
        return;
      }
      if (key === 's') {
        dispatch({ type: 'CYCLE_STAGE', id: view.selectedId, at: isoNow(), by: 'console' });
        event.preventDefault();
        return;
      }
      if (key === 'o') {
        dispatch({ type: 'SET_INVOICE', id: view.selectedId });
        event.preventDefault();
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  /** 7. Command bar. */
  const commandContext: CommandContext = useMemo(
    () => ({ owners: state.team.map((member) => member.name), sources: state.sources }),
    [state.team, state.sources],
  );
  const suggestions: readonly string[] = useMemo(
    () => suggestCommands(state.cmdValue, commandContext),
    [state.cmdValue, commandContext],
  );

  function pushOutput(line: CommandOutputLine): void {
    dispatch({ type: 'PUSH_OUTPUT', line });
  }

  function submitCommand(raw: string): void {
    dispatch({ type: 'SET_CMD_VALUE', value: '' });
    suggestionIndexRef.current = 0;
    const result = parseCommand(raw, commandContext);
    if (!result.ok) {
      pushOutput({ kind: 'err', text: result.message, hint: result.hint });
      return;
    }
    pushOutput({ kind: 'ok', text: result.echo });
    const intent = result.intent;
    switch (intent.kind) {
      case 'filter':
        dispatch({ type: 'SET_FILTER', filter: filterPatch(intent.field, intent.value) });
        return;
      case 'sort':
        dispatch({ type: 'SET_SORT', sort: intent.field });
        return;
      case 'sla':
        dispatch({ type: 'SET_SLA', minutes: intent.minutes });
        return;
      case 'search':
        dispatch({ type: 'SET_FILTER', filter: { query: intent.value } });
        return;
      case 'help':
        dispatch({ type: 'TOGGLE_HELP' });
        return;
      case 'scanlines':
        dispatch({
          type: 'SET_SCANLINES',
          on: intent.value === 'toggle' ? !state.scanlines : intent.value === 'on',
        });
        return;
      case 'clear':
        dispatch({ type: 'SET_FILTER', filter: DEFAULT_FILTER });
        dispatch({ type: 'SET_SORT', sort: 'wait' });
        return;
      case 'goto':
        dispatch({ type: 'SET_ACTIVE_PANE', pane: intent.pane });
        return;
      case 'owner': {
        if (state.selectedId === null) {
          pushOutput({ kind: 'err', text: 'no lead selected', hint: 'j to select, then retry' });
          return;
        }
        const member = state.team.find((person) => person.name === intent.value);
        if (member === undefined) {
          pushOutput({
            kind: 'err',
            text: `no team member '${intent.value}'`,
            hint: 'owner <name>',
          });
          return;
        }
        dispatch({ type: 'SET_OWNER', id: state.selectedId, ownerId: member.id });
        pushOutput({ kind: 'info', text: `${state.selectedId} -> ${member.name}` });
        return;
      }
      case 'unknown':
        pushOutput({ kind: 'err', text: `unknown command '${intent.raw}'`, hint: 'help' });
        return;
      default:
        return;
    }
  }

  function onCmdChange(value: string): void {
    suggestionIndexRef.current = 0;
    dispatch({ type: 'SET_CMD_VALUE', value });
  }

  function onCycleSuggestion(direction: 1 | -1): void {
    if (suggestions.length === 0) return;
    const count = suggestions.length;
    const next = (suggestionIndexRef.current + direction + count) % count;
    suggestionIndexRef.current = next;
    const value = suggestions[next];
    if (value !== undefined) dispatch({ type: 'SET_CMD_VALUE', value });
  }

  function onAcceptSuggestion(): void {
    const value = suggestions[suggestionIndexRef.current];
    if (value === undefined) return;
    suggestionIndexRef.current = 0;
    dispatch({ type: 'SET_CMD_VALUE', value });
  }

  function openComposerFor(id: string): void {
    dispatch({ type: 'SET_COMPOSER', id });
  }

  function sendReply(leadId: string, renderedText: string): void {
    dispatch({
      type: 'RECORD_REPLY',
      id: leadId,
      at: isoNow(),
      messageId: `${leadId}-m-${Date.now()}`,
      text: renderedText,
    });
    dispatch({ type: 'SET_COMPOSER', id: null });
    pushOutput({ kind: 'ok', text: `${leadId} replied, sla stopped` });
  }

  return (
    <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-void font-mono text-phosphor">
      {/* Exactly one scanline overlay, revealed by [data-scanlines='on']. */}
      <div className="crt no-print" aria-hidden />

      <p className="visually-hidden" role="alert" aria-live="assertive" aria-atomic="true">
        {liveMessage}
      </p>

      {ready ? (
        <StatusBar
          now={clock}
          team={state.team}
          totals={totals}
          slaMinutes={state.slaMinutes}
          scanlines={state.scanlines}
          onToggleScanlines={() => dispatch({ type: 'SET_SCANLINES', on: !state.scanlines })}
        />
      ) : null}

      <main className="min-w-0 flex-1 overflow-x-hidden px-2 pb-28 pt-2 md:pb-20">
        {state.status === 'loading' ? (
          <p className="p-2 text-chrome">{'// fetching queue...'}</p>
        ) : null}

        {state.status === 'error' ? (
          <div className="p-2">
            <p className="text-breach">{'// console offline'}</p>
            <p className="mt-1 text-chrome">{state.error ?? 'unknown fetch failure'}</p>
            <button
              type="button"
              className="btn mt-2"
              onClick={() => setFetchKey((key) => key + 1)}
            >
              retry
            </button>
          </div>
        ) : null}

        {ready ? (
          <div className="pane-grid pane-grid--3 min-w-0">
            <section
              className={`pane min-w-0 md:col-span-2 ${
                state.activePane === 'queue' ? '' : 'hidden'
              }`}
              aria-label="Lead queue"
            >
              <div className="pane-head">
                <h2 className="pane-title">queue</h2>
              </div>
              <div className="pane-body min-w-0 overflow-x-hidden">
                <LeadQueue
                  leads={sorted}
                  totalCount={state.leads.length}
                  team={state.team}
                  thresholds={thresholds}
                  slaMinutes={state.slaMinutes}
                  selectedId={state.selectedId}
                  now={clock}
                  sort={state.sort}
                  filter={state.filter}
                  onSelect={(id) => dispatch({ type: 'SELECT', id })}
                  onOpen={(id) => {
                    dispatch({ type: 'SET_DRAWER', id });
                    dispatch({ type: 'SET_INVOICE', id: null });
                  }}
                  onReply={openComposerFor}
                  onCycleStage={(id) =>
                    dispatch({ type: 'CYCLE_STAGE', id, at: isoNow(), by: 'console' })
                  }
                />
              </div>
            </section>

            <section
              className={`pane min-w-0 ${state.activePane === 'funnel' ? '' : 'hidden'}`}
              aria-label="Funnel"
            >
              <div className="pane-head">
                <h2 className="pane-title">funnel</h2>
              </div>
              <div className="pane-body min-w-0 overflow-x-hidden">
                <FunnelPane data={state.stats?.funnel ?? EMPTY_FUNNEL} />
              </div>
            </section>

            <section
              className={`pane min-w-0 ${state.activePane === 'sources' ? '' : 'hidden'}`}
              aria-label="Sources"
            >
              <div className="pane-head">
                <h2 className="pane-title">sources</h2>
              </div>
              <div className="pane-body min-w-0 overflow-x-hidden">
                <SourcePane data={state.stats?.sources ?? EMPTY_SOURCES} />
              </div>
            </section>

            <section
              className={`pane min-w-0 ${state.activePane === 'response' ? '' : 'hidden'}`}
              aria-label="First response"
            >
              <div className="pane-head">
                <h2 className="pane-title">response</h2>
              </div>
              <div className="pane-body min-w-0 overflow-x-hidden">
                <ResponsePane
                  data={state.stats?.responseSeries ?? EMPTY_RESPONSE}
                  slaMinutes={state.slaMinutes}
                />
              </div>
            </section>
          </div>
        ) : null}
      </main>

      <nav className="tabbar md:hidden" aria-label="Panes">
        {PANE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab ${state.activePane === tab.id ? 'tab--active' : ''}`}
            aria-current={state.activePane === tab.id ? 'page' : undefined}
            title={tab.hint}
            onClick={() => dispatch({ type: 'SET_ACTIVE_PANE', pane: tab.id })}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="fixed inset-x-0 bottom-0 z-30 min-w-0 border-rule bg-panel px-2 pb-[calc(var(--tabbar-height))] pt-2 md:pb-2">
        <div ref={cmdBarRef} className="mx-auto min-w-0 max-w-[1600px]">
          <CommandBar
            value={state.cmdValue}
            suggestions={suggestions}
            output={state.cmdOutput}
            onChange={onCmdChange}
            onSubmit={submitCommand}
            onCycleSuggestion={onCycleSuggestion}
            onAcceptSuggestion={onAcceptSuggestion}
          />
        </div>
      </div>

      {ready && drawerLead !== null ? (
        <LeadDrawer
          lead={drawerLead}
          team={state.team}
          thresholds={thresholds}
          slaMinutes={state.slaMinutes}
          now={clock}
          onClose={() => dispatch({ type: 'SET_DRAWER', id: null })}
          onReply={openComposerFor}
          onStageChange={(id, stage) =>
            dispatch({ type: 'SET_STAGE', id, stage, at: isoNow(), by: 'console' })
          }
          onOwnerChange={(id, ownerId) => dispatch({ type: 'SET_OWNER', id, ownerId })}
          onAddNote={(id, text) =>
            dispatch({ type: 'ADD_NOTE', id, at: isoNow(), by: 'console', text })
          }
        />
      ) : null}

      {ready && composerLead !== null ? (
        <ReplyComposer
          lead={composerLead}
          onCancel={() => dispatch({ type: 'SET_COMPOSER', id: null })}
          onSend={sendReply}
        />
      ) : null}

      {ready && invoiceLead !== null ? (
        <InvoiceStub
          lead={invoiceLead}
          onClose={() => dispatch({ type: 'SET_INVOICE', id: null })}
        />
      ) : null}

      <HelpOverlay open={state.helpOpen} onClose={() => dispatch({ type: 'TOGGLE_HELP' })} />
    </div>
  );
}

/** Lookup that tolerates a null id without a non-null assertion. */
function findLead(leads: Lead[], id: string | null): Lead | null {
  if (id === null) return null;
  for (const lead of leads) {
    if (lead.id === id) return lead;
  }
  return null;
}
