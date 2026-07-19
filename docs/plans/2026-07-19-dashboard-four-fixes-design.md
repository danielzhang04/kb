# Dashboard four-fix wave — design & plan (2026-07-19)

Approved by Daniel 2026-07-19 (chat): chat+elicitation for Composer, governed card-respond
route for Inbox, full async git conversion for the daemon. Branch:
`codex/dashboard-operational-surfaces`. Build order: #4 → #3 → #2 → #1
(#4 and #3 run in parallel; they share no files).

## #4 Daemon: async git off the event loop

Problem: four modules run unbounded synchronous `git push/pull origin ops` (and `gh pr
create`) via `execFileSync` on the Fastify event loop with no timeout. One governed write can
chain up to 8 blocking network git calls; a stalled push freezes the whole daemon (observed).

Design:
- New shared async runner in `dashboard/server/write/asyncGit.ts` (name flexible), modeled on
  `control/adapters.ts#createLocalGitCommandRunner`: `spawn`, `shell:false`, `windowsHide`,
  output cap, plus a hard elapsed-time timeout (default 60s) that kills the child, and
  registration in a drain set killed on server `preClose` (pattern: `vibe/session.ts`).
- Widen runner types to `(repoRoot, args) => string | Promise<string>` so existing sync test
  fakes keep working; consumers `await` unconditionally.
- Convert: `audit/log.ts` (appendAudit/commitAuditToOps), `write/branch.ts`
  (prepareCoordination/commitPreparedCoordination/routeCoordination/routeDurable + PrOpener),
  `stop/floor.ts` (requestStop/pauseCadence), `write/cardRouting.ts` inline git,
  `write/launch.ts#launchCard/rerunAsDependsOn`, `write/workflowRun.ts#launchWorkflowRun`
  become async; `write/routes.ts` handlers already async — add `await`.
  `vibe/session.ts`/composer audit call sites follow the async appendAudit.
  `trace/commit.ts` is dormant: convert for consistency, no new callers.
- Out of scope: local `py` runners, read-only kb git, schtasks trigger (already timed).
- Verification: full vitest suite for touched modules; boot daemon (strip-only!); live
  `/api/write/*` smoke.

## #3 Terminal: height chain + unclipped bottom row

Root cause (both symptoms): `.terminal`'s `height:100%` resolves against a bare, height-less
wrapper div in `App.tsx` (~775-785), and `xterm.open()` targets `.terminal__surface`, which
has padding + `overflow:hidden` — so the fitted row grid overflows the clipped content box and
the bottom rows (where `claude`'s TUI input bar lives) are cut off → "frozen" TUI + clipped
typing.

Design:
- Give the persistent-terminal wrapper a real layout: it must fill `.mc-main`'s content box
  with a definite height when visible (e.g. class with `height:100%; min-height:0; display:flex`,
  `hidden` attr still controls visibility). Note `.mc-main` has `--space-8` padding and
  `overflow-y:auto`; terminal view should not double-scroll.
- Move padding off the xterm host: `.terminal__surface` keeps border/rounding/overflow, an
  inner zero-padding element becomes the `xterm.open()` host; FitAddon then measures truly.
- Polish: re-fit after `document.fonts.ready`; keep existing ResizeObserver/onopen fit-and-send.
- Verification: boot daemon + Chrome DevTools MCP against live dashboard: open Terminal, check
  last row fully visible while typing at bottom; run `claude` in the PTY and confirm the input
  bar renders and accepts keys. Server geometry/protocol untouched.

## #2 Inbox: inline resolution via governed card-respond route

Problem: the card-projection feed (input / wake-me / halted / blocked) is read-only; only
decisions have an inline action (evidence verify). Managed HumanRequestsPanel is already fully
actionable — untouched.

Design:
- New session-gated write endpoint `POST /api/write/card-respond` (registered in the write
  surface scope: origin guard + rate limit + requireSession), body
  `{ cardId, action: 'reply' | 'resolve', message }`:
  - `reply` (input items): append the operator's message to the card in a dedicated
    human-response section and transition the card so the owning agent resumes (exact section
    name + transition via `governance/card-schema.md` + `scripts/cards.py` only — never
    hand-rolled state strings).
  - `resolve` (wake-me / halted / blocked items): append resolution note, transition card to
    done/closed per cards.py semantics.
  - Card id validation identical to `approvals/routes.ts` (`CARD_ID_RE`, resolve strictly
    within `queue/{inbox,working,approvals,done}`). Message bounded (≤16k), secret-redaction
    checked like composer prompts. One audit row per call (T2). Ops write via the (now async)
    `branch.ts` coordination plumbing — same pull-rebase/push/retry as other writes.
- `humanInbox.ts` projection: input items get `buttons: ['reply']`; wake-me/halted/blocked get
  `['resolve']`; replace the "not wired yet" nextAction copy.
- Frontend: detail panel in `views/Approvals.tsx` gains a message box + the matching action
  button per category; `ApprovalsLive.tsx` wires it with the same passkey/401-retry flow as
  onVerify; `approvalsClient.ts` gains `respondToCard`. Refetch inbox on success.
- Managed HumanRequestsPanel stays as-is (already complete); no data-model merge in this wave.
- Verification: vitest for route + projection + UI test; live smoke resolving one of the two
  real wake-me cards only with Daniel's go-ahead (they are real coordination state).

## #1 Composer: idea elicitation + visible proposal handoff

Problem: the planning instruction is proposal-format legalese; nothing coaches eliciting the
idea. Proposal handoff requires knowing to open a collapsed panel and click "Compile".

Design:
- Rewrite `composer/planningInstruction.ts` (server-owned): claude's job is to interview the
  operator — ask focused questions one at a time, understand purpose/constraints/success
  criteria, propose approaches — and only when the plan is genuinely ready emit exactly one
  `kb.plan-proposal/v1` block. Keep the full protocol spec (field list, closed-protocol
  rules) as the second half; keep the 6000-char ceiling and existing block format.
- Align the `idea` seed template in `Composer.tsx#seedTemplate` with the same elicitation
  framing (no duplicated protocol text — instruction stays server-owned).
- Proposal handoff visibility: when a completed turn's visible text contains a
  `kb.plan-proposal/v1` fence, surface a prominent "Proposal ready — review & launch" banner
  on the Composer that opens/scrolls to the existing ProposalReviewPanel (which already does
  import → approve → launch). Detection client-side on turn text (cheap, display-only;
  authoritative parsing stays server-side on import).
- Drift cleanup: validator (`control/proposal.ts`) now also requires
  `orgs/<project>/contract.md` in governanceRefs (matching the instruction); remove the dead
  `queued` member from `ComposerTurn.state` in `workspaceClient.ts`.
- Verification: planningInstruction tests updated; proposal validator tests extended for the
  new required ref; live smoke: open Idea composer, one elicitation turn streams.

## Concurrency invariant (BINDING on all future dashboard work)

The ops checkout is a shared mutable resource with a SINGLE-WRITER discipline. The old sync code
enforced this by accident (blocking the event loop); it is now enforced structurally:

1. Every ops-checkout git/gh sequence (prepare → mutate → commit/push, or any self-contained
   transaction) MUST run inside `asyncGit.ts#withOpsTransaction` — a reentrant in-process FIFO lock.
2. The write-capable default runners are created with `requireTransaction: true`: an ops git call
   outside a held transaction REJECTS immediately with a named error. Do not remove this flag; if you
   add a new git call site, wrap the span, don't widen the runner.
3. Anything that must observe output/events across an `await` boundary must attach listeners BEFORE
   the await (see pty/route.ts pre-audit buffering) — event emitters do not replay for late subscribers.
4. Every change to this area must end with: full vitest, `tsc --noEmit`, a strip-types load of
   `server/http/surface.ts`, a daemon boot, and one live governed transaction (e.g. an
   unauthenticated /api/pty probe commits an audit row to ops).

Cross-process writers (fleet runners in other checkouts) are OUT of this lock's scope by design;
their races surface as push rejections handled by the bounded pull-reconcile-retry loops.

## Cross-cutting rules

- Workers: Opus 4.8 or below, model self-reported and transcript-verified; no worker commits —
  orchestrator reviews, runs suites, boots the daemon, commits.
- Strip-only floor: no TS parameter properties / enums / namespaces anywhere new.
- Every wave ends with a real daemon boot + HTTP smoke, not just vitest.
- No pushes to main/ops from this work; branch stays local until Daniel pushes.
