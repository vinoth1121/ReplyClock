import { useEffect } from 'react';
import type { LeadFilter, SortField, SlaState, Stage } from '@/types';

export interface UrlViewState {
  slaMinutes: number;
  sort: SortField;
  filter: LeadFilter;
}

const VALID_SORTS: readonly SortField[] = ['wait', 'created', 'amount', 'name'];
const VALID_STAGES: readonly (Stage | 'all')[] = ['new', 'talks', 'negotiation', 'closed', 'all'];
const VALID_STATES: readonly (SlaState | 'all')[] = ['ok', 'warn', 'breach', 'all'];

export function readUrlState(search: string): Partial<UrlViewState> {
  const params = new URLSearchParams(search);
  const result: Partial<UrlViewState> = {};
  const sla = params.get('sla');
  if (sla !== null) {
    const parsed = Number(sla);
    if (Number.isFinite(parsed)) {
      result.slaMinutes = Math.min(1440, Math.max(2, Math.round(parsed)));
    }
  }
  const sort = params.get('sort');
  if (sort !== null && VALID_SORTS.includes(sort as SortField)) {
    result.sort = sort as SortField;
  }
  const filter: LeadFilter = { stage: 'all', owner: 'all', state: 'all', source: 'all', query: '' };
  const stage = params.get('stage');
  if (stage !== null && VALID_STAGES.includes(stage as Stage | 'all')) {
    filter.stage = stage as Stage | 'all';
  }
  const owner = params.get('owner');
  if (owner !== null) filter.owner = owner;
  const state = params.get('state');
  if (state !== null && VALID_STATES.includes(state as SlaState | 'all')) {
    filter.state = state as SlaState | 'all';
  }
  const source = params.get('source');
  if (source !== null) filter.source = source;
  const query = params.get('q');
  if (query !== null) filter.query = query;
  result.filter = filter;
  return result;
}

export function writeUrlState(state: UrlViewState): void {
  const params = new URLSearchParams();
  params.set('sla', String(state.slaMinutes));
  params.set('sort', state.sort);
  if (state.filter.stage !== 'all') params.set('stage', state.filter.stage);
  if (state.filter.owner !== 'all') params.set('owner', state.filter.owner);
  if (state.filter.state !== 'all') params.set('state', state.filter.state);
  if (state.filter.source !== 'all') params.set('source', state.filter.source);
  if (state.filter.query !== '') params.set('q', state.filter.query);
  const url = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, '', url);
}

export function useUrlSync(state: UrlViewState): void {
  useEffect(() => {
    writeUrlState(state);
  }, [state.slaMinutes, state.sort, state.filter]);
}