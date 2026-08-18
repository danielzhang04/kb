# Proposal: brain-query runtime — spawn-per-query CLI behind the dashboard search route

**Status:** PROPOSAL. Decision-note, not an activation ask — the code is already live behind
`GET /api/brain/search` (once the dashboard wiring commit passes `repoRoot` at the call site in
`dashboard/server/index.ts`; that edit is out of scope here, see "Wiring" below).

**Built:** 2026-08-18, Agent Platform Wave 1, unit U2. Code: `scripts/brain/brain_query.py`
(query CLI), `dashboard/server/brain/routes.ts` (`GET /api/brain/search`),
`dashboard/src/views/agentPlatform/panels/BrainSearch.panel.tsx` (UI). Tests:
`tests/test_brain_query.py`, `dashboard/server/brain/routes.test.ts`,
`dashboard/src/views/agentPlatform/panels/BrainSearch.panel.test.tsx`.

## What it does

Every search request spawns a fresh `py -3 -m scripts.brain.brain_query` process, which loads the
`.brain-index` manifest, constructs a `sentence-transformers` embedder (loading the ~90MB
`all-MiniLM-L6-v2` model into that process from scratch), embeds the query, ranks the index's
vectors, and prints one JSON object to stdout. The route execs the CLI, parses stdout, and returns
the payload (or an availability/reason pair) to the panel. No process persists between requests —
the model is loaded and discarded on every call.

## Measured latency

Consecutive queries against the real built index (this machine, warm OS file cache, cold Python
process each time): **22s, 16s, 10s** for the first three calls in a row, settling to a steady
state around 10-12s once the OS has the model weights and Python's import cache warm in its file
cache. A follow-up spot-check during this fix (`tests/test_brain_query.py -m slow`, plus three more
consecutive CLI probes) reproduced the same shape: two ~19s slow-test runs from a colder start,
then three back-to-back CLI probes at 11.0s / 11.4s / 12.5s. The dominant cost in every run is
process start + `sentence-transformers` import + model weight load, not the vector search itself
(the search over a few thousand chunks is sub-millisecond once the model is resident).

This means the panel's honest floor is **10-20 seconds per query, every query** — not a one-time
warm-up. The panel copy was corrected to say this (see the sibling U2 fix in
`BrainSearch.panel.tsx`); it previously read "the first query loads the embedding model," which
was false for query two onward.

## Why spawn-per-query was the right Wave-1 minimum

Wave 1 armed nothing new by default — no daemon, no long-running worker process, no background
service the fleet has to keep alive, restart on crash, or reason about as a new failure mode. A
spawn-per-query CLI is the smallest thing that could possibly search the index from the dashboard:

- It reuses the exact CLI a human already runs at the terminal (`py -3 -m
  scripts.brain.brain_query`), so there is one code path, not two, to keep correct.
- It has no state to leak across requests — no shared process means no risk of one user's query
  context bleeding into another's, no server-lifetime memory growth from the model or from cached
  embeddings, and a crash costs exactly one query rather than every query until someone notices and
  restarts a daemon.
- It costs nothing to turn off — deleting the route (or leaving `dashboard/server/index.ts`
  unwired, which it currently is) leaves zero standing processes, zero ports, zero systemd/pm2
  entries to reconcile.

The 10-20s tax is the price of that minimalism, and it is a price Wave 1 can afford: brain search
is a low-frequency, ad hoc lookup panel, not a hot path something else depends on.

## Wave-2 follow-up (named, not built)

**Persistent sidecar or an in-process fast CPU embedder** to take the cost below ~200ms:

1. **Persistent sidecar process.** Keep one `sentence-transformers` process warm (spawned once,
   fed queries over stdin/a local socket, or a tiny FastAPI/Fastify-adjacent process on a loopback
   port) so the model load happens once per daemon lifetime instead of once per query. This is the
   smallest change from today's shape but reintroduces exactly the standing-process tradeoffs
   Wave 1 avoided: a process to keep alive, restart on crash, and reason about when it goes stale
   relative to a rebuilt index.
2. **A CPU-native runtime that loads faster and/or embeds directly in the Node process** —
   `fastembed` (ONNX Runtime under the hood) or a hand-rolled ONNX CPU session for
   `all-MiniLM-L6-v2`. ONNX Runtime's CPU load path is meaningfully faster than
   `sentence-transformers`' PyTorch import + weight load, and if the runtime has a usable Node
   binding, the route could embed the query in-process and skip `execFile`/argv entirely — which
   also removes the whole class of argv-injection concerns this fix just patched over (see
   "Blocker" note in the U2 card).

Either direction should target **sub-200ms per query** — small enough that "search as you type"
becomes viable, which spawn-per-query never will be. Neither is built; this is the named follow-up,
not a decision between the two.

## Open operational questions

- **Read-rate budget vs 90MB model loads.** Nothing currently throttles concurrent or rapid-fire
  requests to `/api/brain/search`. Each one is a fresh ~90MB model load plus a fresh Python
  interpreter start; a handful of concurrent searches (multiple dashboard tabs, or a script hitting
  the endpoint in a loop) multiplies that directly into CPU and memory pressure with no queue or
  rate limit in front of it. `QUERY_TIMEOUT_MS = 60_000` in `routes.ts` bounds a single request's
  worst case but does nothing to bound concurrency. Worth a rate limit or a request queue before
  this route is exposed beyond a single operator's local dashboard.
- **Index-freshness surfacing.** The CLI's `--json` success payload now echoes `model`,
  `created_at`, and `chunk_count` from the index manifest (this fix), but nothing in the route or
  panel surfaces `created_at` to the user today — a stale index (built before recent commits) looks
  identical to a fresh one in the UI. A reasonable Wave-2 addition: the panel renders "index built
  <relative time>" from the already-echoed `created_at`, so a visibly stale index prompts a rebuild
  rather than silently under-serving results.
- **`py -3` is hardcoded** in `dashboard/server/brain/routes.ts`'s `defaultRunQuery` — the Windows
  Python launcher convention (`py -3 -m ...`) used throughout this repo's scripts. This is a
  portability note, not a bug for Wave 1: the dashboard daemon runs on this Windows machine today.
  A Linux/macOS deployment (the cloud-migration arc already runs the dashboard daemon off-Windows)
  would need this to resolve to `python3` or an explicit interpreter path instead, likely via the
  same `DASHBOARD_REPO_ROOT`-style environment override pattern already used for `repoRoot`.

## Wiring

`registerBrainSearch(app, options)` already accepts `options.repoRoot` and uses it in place of
deriving the path from `import.meta.url` when provided (mirroring `kbBrowserRoutes`'s
`opts.repoRoot ?? defaultRepoRoot()` shape in `dashboard/server/kb/routes.ts`). The one remaining
step — passing `repoRoot` at the `registerBrainSearch(scope)` call site in
`dashboard/server/index.ts` (currently called with no options, so it falls back to
`import.meta.url` derivation) — belongs to the wiring commit, not this fix, per this unit's scope
boundary (`dashboard/server/index.ts` is contended and wired separately).

## Verification

```
py -3 -m pytest tests/test_brain_query.py -q
py -3 -m pytest tests/test_brain_query.py -q -m slow
cd dashboard && npx.cmd vitest run server/brain src/views/agentPlatform/panels/BrainSearch.panel.test.tsx
cd dashboard && npx.cmd tsc --noEmit
```
