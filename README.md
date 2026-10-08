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

