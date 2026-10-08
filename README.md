# ReplyClock

**Live demo:** [https://replyclock.vercel.app](https://replyclock.vercel.app)

*A speed-to-lead console for WhatsApp sales teams that makes first-reply time the primary metric, not an afterthought.*

![ReplyClock demo](public/demo.gif)

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

## What I'd build next

- **Persist mutations.** Stage changes, owner assignments, notes, and recorded replies live in the reducer and vanish on refresh. A real store with the same reducer shape on top.
- **Real WhatsApp Business API ingestion.** Replace the seeded generator with webhook ingestion so leads arrive live.
- **Per-owner SLA targets.** The team has one threshold today. Real floors run different targets per role.
- **Breach alerts.** Send a WhatsApp message to a team group the moment a lead crosses the line.
- **CSV export.** With filters applied, an operator needs to hand the queue to someone else.
- **Multi-tenant workspaces.** Per-workspace ad accounts, members, and SLA targets.

