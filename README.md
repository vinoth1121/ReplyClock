# ReplyClock

**Live demo: https://replyclock.vercel.app**

A speed-to-lead console for sales teams that get leads through WhatsApp. Its one job: make sure no lead waits too long for a first reply.

## The pitch

Most lead dashboards answer "how many leads did we get?" ReplyClock answers the only question that decides whether those leads are worth anything: **how long did each one wait for a first reply, and is anyone blowing past the line right now?**

Leads arrive from click-to-WhatsApp ads. Somebody has to notice each one, decide who owns it, and send a first message. The clock starts the moment the lead arrives and stops the moment the reply goes out. Most teams only find out they were slow afterwards, in a monthly report, when the lead is already gone.

ReplyClock puts the clock on screen as the primary object. The queue is sorted by who is closest to breaching, not by who was most recent. Breach state is carried by colour and by text, so it survives a monochrome monitor, a colourblind operator, and a screen reader. When a lead crosses the line, the console says so once, and then only once.

Response speed is the primary metric here. Everything else — the funnel, the source attribution, the response-time history — exists to tell you _why_ the number moved, and whether the fix is to change the ads or to change the floor.

## Keyboard walkthrough

Press `?` in the app for the full list. A typical session looks like this:

```text
$ j                                  # next lead, down the queue by urgency
$ j
$ Enter                              # open the lead detail drawer
$ r                                  # open the reply composer
  template: Send quote               # pick from the four templates
  name / product / amount_inr        # fill the variables
  preview: "Hi Preeti, here is the   # see the exact text before it goes
   quote for the Yoga Mat Bundle:
   1,499, GST extra. ..."
  [ Open WhatsApp and record reply ] # real wa.me link, new tab
$ Esc                                # back to the queue
$ / filter stage=breach              # command bar, with autocomplete
$ / sort wait
$ g then s                           # jump to the sources pane
```

That is a text transcript of the keyboard flow, not a screen recording. A recorded GIF of the same walkthrough belongs at `public/demo.gif`.

## Why this is different

**SLA-first design.** The wait timer is not a column in a table, it is the thing the whole screen is organised around. Queue order is urgency order, the status bar carries SLA health, and the response-time pane exists to show whether the team is trending inside or outside target. Breach state is never signalled by colour alone: a breached row also reads `BREACH`, carries a `+Nm over` overflow, and exposes the whole state in its accessible name. Newly breached leads are announced once through an `aria-live` region that diffs against previously announced ids, so a screen reader hears each breach exactly one time instead of every second.

**Source-ad attribution that isn't vanity metrics.** Lead volume per ad is easy to measure and tells you almost nothing. The attribution pane pairs leads-per-ad against close-rate-per-ad, which is the pairing that changes a budget. The demo data makes the point immediately: `CTWA-Loan-EMI-0` produced 18 leads and closed 11% of them, while `CTWA-Referral-Cashback` produced 5 leads and closed 60%. One of those ads is a content problem disguised as a lead-gen win.

**The WhatsApp reply flow actually works.** Pick one of four templates, fill `{name}`, `{product}` and `{amount_inr}`, read the exact text in a live preview, then open a real `https://wa.me/<number>?text=<encoded>` link. Sending it records the first reply, which stops the SLA timer. No mock, no stub handoff to a CRM. A missing variable is reported by name and blocks the send rather than producing a message with stray braces in it.

**Keyboard-driven, not keyboard-only.** `j`/`k` walk the queue, `g` then `q`/`f`/`s`/`r` jumps panes, `/` focuses the command bar, `?` opens help. The command bar parses typed commands with autocomplete and actionable errors — `slae 45` suggests `did you mean 'sla'?`, and `sla 45.5` tells you to drop the decimal. Everything reachable by keyboard is also reachable by mouse, including per-row stage and owner selects.

## Keyboard shortcuts

| Key                | Action                                 |
| ------------------ | -------------------------------------- |
| `j` / `↓`          | Next lead                              |
| `k` / `↑`          | Previous lead                          |
| `Enter`            | Open lead detail                       |
| `r`                | Open reply composer                    |
| `s`                | Advance stage                          |
| `o`                | Open invoice stub                      |
| `/`                | Focus the command bar                  |
| `?`                | Toggle this help overlay               |
| `g` then `q`       | Jump to the lead queue                 |
| `g` then `f`       | Jump to the funnel                     |
| `g` then `s` / `a` | Jump to source attribution             |
| `g` then `r`       | Jump to response time                  |
| `Esc`              | Close composer, then drawer, then help |

## Command bar

| Command                                             | What it does                               |
| --------------------------------------------------- | ------------------------------------------ |
| `help`                                              | list every command                         |
| `filter stage=new\|talks\|negotiation\|closed\|all` | show leads in one stage                    |
| `filter state=ok\|warn\|breach\|all`                | show leads by sla health                   |
| `filter owner=<first last>\|unassigned\|all`        | show leads by assigned seller              |
| `filter source=<ad>\|all`                           | show leads by ad or campaign name          |
| `sort wait\|created\|amount\|name`                  | order the lead list                        |
| `sla <minutes>`                                     | set the breach threshold, 2-1440           |
| `owner <name>`                                      | assign the selected lead to a seller       |
| `search <query>`                                    | find leads by name, id, phone or city      |
| `goto q\|f\|s\|r`                                   | jump to queue, funnel, sources or response |
| `scanlines on\|off\|toggle`                         | toggle the crt scanline overlay            |
| `clear`                                             | reset filters, sort and search to defaults |

The SLA threshold is live. `sla 45` recolours the queue, moves the reference line on the response-time chart, and re-derives every breach count immediately.

## Architecture

```text
app/
  (console)/page.tsx      console shell: reducer, live clock, keymap, layout
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
npm install
npm run dev        # http://localhost:3000
```

| Script                 | Purpose                    |
| ---------------------- | -------------------------- |
| `npm run dev`          | dev server                 |
| `npm run build`        | production build           |
| `npm run start`        | serve the production build |
| `npm test`             | run the unit tests once    |
| `npm run test:watch`   | run tests in watch mode    |
| `npm run typecheck`    | `tsc --noEmit`             |
| `npm run lint`         | ESLint via `next lint`     |
| `npm run format`       | Prettier write             |
| `npm run format:check` | Prettier check             |

## Data and demo notes

All data is synthetic, generated from a fixed seed. There is no database, no external service, and no real personal data — names, cities, phone numbers and rupee amounts are all invented.

`/api/leads` and `/api/stats` regenerate on every request with caching explicitly disabled (`Cache-Control: no-store`). This is deliberate: the pending and breached counts are derived from timers that are still running, so a cached response would freeze the SLA clocks and understate who is actually in breach.

`/api/stats` accepts an optional `?sla=<minutes>` override (clamped to 2–1440). A malformed value such as `?sla=abc` returns 200 with the default rather than failing, because a hard error would blank the console instead of falling back to the value already on screen.

The SLA threshold also lives in client state, so `sla 45` updates the queue, the charts and the breach counts without a round trip.

## Testing

246 unit tests across three files cover the modules where a bug would be silent and expensive:

- `sla.test.ts` (59) — threshold derivation and clamping, the exact `>=` boundaries at warn and breach, the rule that a replied lead is always `ok`, that `firstReplyAt` freezes the timer so it does not grow as `now` advances, true-median calculation, and that `sortByUrgency` / `filterLeads` / `sortLeads` never mutate their input arrays.
- `commands.test.ts` (133) — every command, both `=` and `:` separators, case and whitespace tolerance, SLA range validation, multi-word values like `filter owner=Vikram Rao`, did-you-mean suggestions, and a no-throw sweep across malformed input.
- `format.test.ts` (54) — `en-IN` rupee grouping (`₹1,23,456`, never `₹999.00`), the wait-format ladder including the rule that seconds only appear below ten minutes, phone normalisation, and safe fallbacks for unparseable values.

## Accessibility

- Everything is reachable by keyboard, with a visible 2px focus ring on every interactive element.
- The lead queue is a semantic `<table>` with roving `tabindex` and `aria-selected`, so arrow keys move the selection without the screen reader losing its place.
- Breach announcements go through an `aria-live` region that diffs against previously announced leads, so each breach is spoken once rather than every second.
- The drawer, composer, invoice and help overlay implement real focus trapping, Escape handling and focus restoration.
- Both Recharts charts carry a computed text alternative describing the shape and the key finding, since the SVG itself has no useful semantics.
- The CRT scanline overlay is opt-in (`scanlines on`) and forced off under `prefers-reduced-motion: reduce`.
- Colour is never the only signal: breach and warning states also carry text markers.

## What I'd build next

- **Persist the mutations.** Stage changes, owner assignments, notes and recorded replies currently live in the reducer and vanish on refresh. A real store — Postgres or a hosted KV — with the same reducer shape on top.
- **Ingest leads from the real WhatsApp Business API.** Replace the seeded generator with webhook ingestion so leads arrive live and the clock starts at the actual message, not at page load.
- **Per-owner SLA targets.** The team has one threshold today. Real floors run different targets per role — an SDR's first response and a closing AE's first response are not the same clock.
- **Alert the team on breach.** The console tells one operator; nobody is watching it at 2am. Send a WhatsApp message to a team group the moment a lead crosses the line.
- **CSV export of the current queue.** With filters applied, an operator needs to hand the queue to someone else. It is a small feature with immediate daily value.
- **Multi-tenant workspaces.** Per-workspace ad accounts, members and SLA targets, with row-level scoping on every query.

## Notes

This project pins `next@14.2.35`, the patched release of the Next.js 14 line. That patch cleared the published advisory it was upgraded for. Next.js 14 is, however, end-of-life upstream, and `npm audit` still reports advisories against the whole 14.x range whose only offered fix is a two-major jump to Next 16. Staying on 14 was a deliberate choice for this build; moving to 16 is the right call for anything long-lived.
