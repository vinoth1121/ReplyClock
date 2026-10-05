/**
 * ReplyClock lead feed.
 *
 * Read-only: the console mutates its own copy client-side in a reducer, so this
 * handler only ever serves the freshly generated seed. There is no database and
 * nothing is written.
 */

import { NextResponse } from 'next/server';

import type { LeadsPayload } from '@/types';
import { generateSeed } from '@/lib/seed';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Returns the full lead queue, the team roster and the ad list, regenerated on
 * every hit.
 *
 * Caching is disabled deliberately. A lead that has not received a first reply
 * yet carries a *running* wait timer, and the client countdown is anchored to
 * the `now` this route reports. A cached response would freeze every SLA clock
 * at the moment it was cached, so the console would understate who is actually
 * in breach. `force-dynamic` / `revalidate = 0` are therefore paired with
 * explicit no-store headers rather than relying on either alone.
 *
 * No authentication. This is a public demo endpoint and the payload holds
 * nothing but synthetic data: invented names, cities, Indian phone numbers and
 * rupee amounts drawn from a fixed seed. There is no real lead, no real WhatsApp
 * number and no credential to protect.
 *
 * Errors are intentionally *not* caught. There is no try/catch fallback that
 * would return a 200-shaped payload on purpose: a swallowed failure would look
 * like a healthy console with an empty queue and nobody to reply to, which is
 * worse than a visible error. Letting the throw propagate surfaces a real 500
 * and flags that the dataset generator is broken.
 */
export async function GET(): Promise<NextResponse<LeadsPayload>> {
  const now = Date.now();
  const bundle = generateSeed(now);

  return NextResponse.json<LeadsPayload>(
    {
      leads: bundle.leads,
      team: bundle.team,
      sources: bundle.sources,
      generatedAt: bundle.generatedAt,
      now: new Date(now).toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    },
  );
}
