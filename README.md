# ReplyClock

**Live demo:** [https://vinoth1121.github.io/ReplyClock/](https://vinoth1121.github.io/ReplyClock/)

![ReplyClock timeline](public/demo.gif)

*A speed-to-lead console for WhatsApp sales teams that makes first-reply time the primary metric, not an afterthought.*

## The pitch

Most lead dashboards answer "how many leads did we get?" ReplyClock answers the only question that decides whether those leads are worth anything: **how long did each one wait for a first reply, and is anyone blowing past the line right now?**

Leads arrive from click-to-WhatsApp ads. Somebody has to notice each one, decide who owns it, and send a first message. The clock starts the moment the lead arrives and stops the moment the reply goes out. Most teams only find out they were slow afterwards, in a monthly report, when the lead is already gone.

ReplyClock puts the clock on screen as the primary object. The queue is sorted by who is closest to breaching, not by who was most recent. Breach state is carried by colour and by text, so it survives a monochrome monitor, a colourblind operator, and a screen reader. When a lead crosses the line, the console says so once, and then only once.

## Why this is different

**Visual proof-of-play timeline.** The response-time pane is a 14-day median first-reply timeline, not a static KPI. Each row in the queue carries its own live wait timer that ticks every second, freezes the moment the first reply goes out, and is sorted by urgency — so the operator always sees who is about to breach next.

**URL-synced state.** Every filter, sort, and SLA threshold lives in the URL query string. `?sla=45&sort=wait&stage=breach` is a shareable, bookmarkable link to exactly the view you are looking at. `history.replaceState` keeps the back button clean while the URL stays in sync with the console.

**Optimistic updates.** Stage changes, owner assignments, notes, and recorded replies apply instantly in the client reducer before any server round-trip. The UI never waits on a network call to reflect what the operator just did.

**MSW-backed realistic API.** The demo runs on a Mock Service Worker that intercepts `/api/leads` and `/api/stats` in the browser and serves the same deterministic, seeded dataset the server routes produce. No backend, no database, no network dependency — just realistic latency and realistic data.

**The WhatsApp reply flow actually works.** Pick one of four templates, fill `{name}`, `{product}`, and `{amount_inr}`, read the exact text in a live preview, then open a real `https://wa.me/<number>?text=<encoded>` link. Opening WhatsApp records the first reply, which stops the SLA timer. A missing variable blocks the send and reports the missing field by name.

**Keyboard-first, not keyboard-only.** `j`/`k` walk the queue, `g` then `q`/`f`/`s`/`r` jumps panes, `/` focuses the command bar, `?` opens help. Everything is also reachable by mouse, including per-row stage and owner selects.

## Architecture

```text
app/
  (console)/page.tsx      console shell: reducer, live clock, keymap, URL sync
  api/leads/route.ts      read-only lead feed, no-store
  api/stats/route.ts      read-only rollup, accepts ?sla=<minutes>
  globals.css             design tokens, ascii pane borders, crt overlay, print
  layout.tsx              root layout, JetBrains Mono via next/font
components/
  panes/                  status bar, lead queue, funnel, source, response
  drawer/                 lead detail, reply composer, gst invoice stub
  commandbar/             command bar with combobox autocomplete
  charts/                 restyled Recharts source + response charts
  HelpOverlay.tsx         keyboard and command reference
lib/
  sla.ts                  thresholds, urgency ordering, filtering, summary
  format.ts               INR, wait, clock, phone, percent formatters
  commands.ts             command parser, autocomplete, help table
  templates.ts            four reply templates, wa.me link builder
  seed.ts                 deterministic seeded lead generator
  useUrlState.ts          URL query-string sync for shareable views
mocks/
  handlers.ts             MSW handlers for /api/leads and /api/stats
  browser.ts              MSW service worker bootstrap
  server.ts               MSW node server for tests
types/index.ts            lead, team, sla and stats contracts
tests/                    246 unit tests over sla, commands, format
```

Four decisions shape the rest:

- **No database.** `lib/seed.ts` is a seeded generator (`mulberry32`) that computes every lead's `createdAt` relative to load time, so the demo always has live breaches instead of a frozen snapshot. The same seed always produces the same dataset for a given `now`.
- **Domain logic is pure and separately tested.** Everything in `lib/` is side-effect free: no clock reads, no randomness, no I/O. `now` is always a parameter. That is what lets 246 tests run in milliseconds with no DOM and no mocking.
- **One reducer, read-only API.** The route handlers only ever serve a freshly generated payload; the client mutates its own copy in a single `useReducer`. There is no write path to a server, and nothing to fall out of sync.
- **Time is injected.** Every component takes `now` as a prop, ticked once per second by the shell. No component calls `Date.now()` during render, which keeps SLA logic deterministic and testable, and keeps the server and client render in agreement.

## Run locally

Requires Node 18.17 or newer.

```bash
git clone https://github.com/vinoth1121/ReplyClock.git
cd ReplyClock
npm install
npm run dev        # http://localhost:3000
```

## Test commands

```bash
npm test             # run the unit test suite once (vitest run)
npm run test:watch   # run tests in watch mode
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint via next lint
npm run format       # Prettier write
npm run format:check # Prettier check
```

246 unit tests across three files cover the modules where a bug would be silent and expensive:

- `sla.test.ts` (59) — threshold derivation and clamping, the exact `>=` boundaries at warn and breach, the rule that a replied lead is always `ok`, that `firstReplyAt` freezes the timer so it does not grow as `now` advances, true-median calculation, and that `sortByUrgency` / `filterLeads` / `sortLeads` never mutate their input arrays.
- `commands.test.ts` (133) — every command, both `=` and `:` separators, case and whitespace tolerance, SLA range validation, multi-word values like `filter owner=Vikram Rao`, did-you-mean suggestions, and a no-throw sweep across malformed input.
- `format.test.ts` (54) — `en-IN` rupee grouping (`₹1,23,456`, never `₹999.00`), the wait-format ladder including the rule that seconds only appear below ten minutes, phone normalisation, and safe fallbacks for unparseable values.

## What I'd build next

- **Persist the mutations.** Stage changes, owner assignments, notes and recorded replies currently live in the reducer and vanish on refresh. A real store — Postgres or a hosted KV — with the same reducer shape on top.
- **Ingest leads from the real WhatsApp Business API.** Replace the seeded generator with webhook ingestion so leads arrive live and the clock starts at the actual message, not at page load.
- **Per-owner SLA targets.** The team has one threshold today. Real floors run different targets per role — an SDR's first response and a closing AE's first response are not the same clock.
- **Alert the team on breach.** The console tells one operator; nobody is watching it at 2am. Send a WhatsApp message to a team group the moment a lead crosses the line.
- **CSV export of the current queue.** With filters applied, an operator needs to hand the queue to someone else. It is a small feature with immediate daily value.
- **Multi-tenant workspaces.** Per-workspace ad accounts, members and SLA targets, with row-level scoping on every query.