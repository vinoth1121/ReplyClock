# ReplyClock

**Live demo:** Not currently deployed on Vercel (https://replyclock.vercel.app returns incorrect content). Verified source: https://github.com/vinoth1121/ReplyClock

![ReplyClock demo](public/demo.gif)

*A speed-to-lead console for WhatsApp sales teams that makes first-reply time the primary metric, not an afterthought.*

## Why this is different

**Working SLA estimator.** Type `sla 30`, `sla 60`, or `sla 120` in the command bar and watch the queue, breach counts, and response-time chart update instantly. No page reload, no server round-trip. The response-time pane shows the 14-day median trend.

**Shareable URL state.** The command bar captures every filter, sort, and SLA threshold as typed commands. The `/api/stats` endpoint accepts `?sla=<minutes>` as a URL parameter. Sharing a filtered queue is a single copy-paste away.

**Zero-dependency core.** The business logic lives in `lib/` as pure TypeScript. Zero runtime dependencies. No React, no Next.js, no DOM. 246 unit tests run in milliseconds with no mocking because `now` is always an explicit parameter.

**The WhatsApp reply flow actually works.** Pick one of four templates, fill `{name}`, `{product}`, and `{amount_inr}`, read the exact text in a live preview, then open a real `https://wa.me/<number>?text=<encoded>` link. A missing variable blocks the send and reports the missing field by name.

**Keyboard-first, not keyboard-only.** `j`/`k` walk the queue, `g` then `q`/`f`/`s`/`r` jumps panes, `/` focuses the command bar, `?` opens help. Everything is also reachable by mouse.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 14 (App Router) |
| UI | React 18 + Tailwind CSS |
| Font | JetBrains Mono |
| Charts | Recharts (source + response) |
| Testing | Vitest (246 unit tests) |
| Linting | ESLint + Prettier |
| No database | Seeded `mulberry32` generator |

## Run locally

Requires Node 18.17 or newer.

```bash
git clone https://github.com/vinoth1121/ReplyClock.git
cd ReplyClock
npm install
npm run dev        # http://localhost:3000
```

| Script | Purpose |
|--------|---------|
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run start` | serve the production build |
| `npm test` | run the unit tests once |
| `npm run test:watch` | run tests in watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint via `next lint` |
| `npm run format` | Prettier write |
| `npm run format:check` | Prettier check |

## Lighthouse scores

Run the production build and audit with Lighthouse:

```bash
npm run build
npm run start
# Open http://localhost:3000 in Chrome, then run Lighthouse
```

Expected scores on a cold build:

- **Performance:** 95–100 (single clock interval, `no-store` headers, minimal JS)
- **Accessibility:** 95–100 (semantic table, roving tabindex, `aria-live`, focus trapping)
- **Best Practices:** 90–100
- **SEO:** 90–100

## What I’d build next

- **Persist mutations.** Stage changes, owner assignments, notes, and recorded replies live in the reducer and vanish on refresh. A real store with the same reducer shape on top.
- **Real WhatsApp Business API ingestion.** Replace the seeded generator with webhook ingestion so leads arrive live.
- **Per-owner SLA targets.** The team has one threshold today. Real floors run different targets per role.
- **Breach alerts.** Send a WhatsApp message to a team group the moment a lead crosses the line.
- **CSV export.** With filters applied, an operator needs to hand the queue to someone else.
- **Multi-tenant workspaces.** Per-workspace ad accounts, members, and SLA targets.

## Accessibility

- Everything is reachable by keyboard, with a visible 2px focus ring on every interactive element.
- The lead queue is a semantic `<table>` with roving `tabindex` and `aria-selected`.
- Breach announcements go through an `aria-live` region that diffs against previously announced leads.
- The drawer, composer, invoice and help overlay implement real focus trapping, Escape handling and focus restoration.
- Both Recharts charts carry a computed text alternative describing the shape and key findings.
- The CRT scanline overlay is opt-in and forced off under `prefers-reduced-motion: reduce`.
- Colour is never the only signal: breach and warning states also carry text markers.

## Testing

246 unit tests across three files cover the modules where a bug would be silent and expensive:

- `sla.test.ts` (59) — threshold derivation and clamping, exact `>=` boundaries at warn and breach, the rule that a replied lead is always `ok`, that `firstReplyAt` freezes the timer, true-median calculation, and that `sortByUrgency` / `filterLeads` / `sortLeads` never mutate their input arrays.
- `commands.test.ts` (133) — every command, both `=` and `:` separators, case and whitespace tolerance, SLA range validation, multi-word values, did-you-mean suggestions, and a no-throw sweep across malformed input.
- `format.test.ts` (54) — `en-IN` rupee grouping, the wait-format ladder, phone normalisation, and safe fallbacks for unparseable values.

