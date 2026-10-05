/**
 * ReplyClock domain types.
 *
 * ReplyClock is a speed-to-lead console: a lead that has not received a first
 * reply has a *running* wait timer, and the timer freezes the moment the first
 * reply is sent.
 */

/** Sales pipeline stage of a lead. */
export type Stage = 'new' | 'talks' | 'negotiation' | 'closed';

/** SLA health of a lead, derived from how long it has been awaiting a reply. */
export type SlaState = 'ok' | 'warn' | 'breach';

/** Identifier of a pane in the console shell. */
export type PaneId = 'queue' | 'funnel' | 'sources' | 'response';

/** Field the visible lead list is sorted by. */
export type SortField = 'wait' | 'created' | 'amount' | 'name';

/**
 * Lead list filter. Every axis uses the literal `'all'` to mean "no
 * constraint"; `owner` additionally accepts the literal `'unassigned'`.
 */
export type LeadFilter = {
  stage: Stage | 'all';
  owner: string | 'all';
  state: SlaState | 'all';
  source: string | 'all';
  query: string;
};

/** A seller on the team. */
export interface TeamMember {
  id: string;
  name: string;
  role: string;
  online: boolean;
  initials: string;
}

/** A recorded stage transition. */
export interface StageEvent {
  stage: Stage;
  at: string;
  by: string;
}

/** A single WhatsApp message in the lead transcript. */
export interface ChatMessage {
  id: string;
  direction: 'in' | 'out';
  at: string;
  text: string;
}

/** An internal note attached to a lead. */
export interface LeadNote {
  id: string;
  at: string;
  by: string;
  text: string;
}

/** A lead awaiting, or having received, a first reply. */
export interface Lead {
  /** e.g. `'LD-1042'`. */
  id: string;
  name: string;
  city: string;
  /** Digits only, country code included, no `+`. e.g. `'919812345678'`. */
  phone: string;
  /** e.g. `'CTWA-Diwali-Offer'`. */
  source: string;
  stage: Stage;
  ownerId: string | null;
  product: string;
  amountInr: number;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601; `null` means the lead is still waiting for a first reply. */
  firstReplyAt: string | null;
  transcript: ChatMessage[];
  timeline: StageEvent[];
  notes: LeadNote[];
}

/** Deterministic dataset backing the console. */
export interface SeedBundle {
  leads: Lead[];
  team: TeamMember[];
  sources: string[];
  generatedAt: string;
}

/** One row of the funnel view. */
export interface FunnelStage {
  stage: Stage;
  label: string;
  count: number;
  prevCount: number | null;
  conversionPct: number | null;
}

/** Per-source rollup of lead volume and close rate. */
export interface SourceStat {
  source: string;
  leads: number;
  closed: number;
  closeRatePct: number;
}

/** One day of the first-response time series. */
export interface ResponsePoint {
  day: string;
  iso: string;
  medianFirstReplyMinutes: number;
}

/** Aggregated counters for the console header and stats panes. */
export interface StatsPayload {
  now: string;
  slaMinutes: number;
  totals: {
    leads: number;
    replied: number;
    pending: number;
    breached: number;
    warn: number;
    medianFirstReplyMinutes: number;
    pipelineInr: number;
  };
  funnel: FunnelStage[];
  sources: SourceStat[];
  responseSeries: ResponsePoint[];
}

/** Lead list payload. */
export interface LeadsPayload {
  leads: Lead[];
  team: TeamMember[];
  sources: string[];
  generatedAt: string;
  now: string;
}

/** Canonical pipeline ordering, first stage first. */
export const STAGE_ORDER: readonly Stage[] = ['new', 'talks', 'negotiation', 'closed'] as const;

/** Human readable label for each pipeline stage. */
export const STAGE_LABEL: Record<Stage, string> = {
  new: 'New',
  talks: 'In Talks',
  negotiation: 'Negotiation',
  closed: 'Closed',
};
