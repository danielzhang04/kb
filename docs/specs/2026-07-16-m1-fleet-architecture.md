# Month-1 Fleet Architecture & Build Scope

Synthesis of five research tracks (approvals, transport, adapters, grader, roles) into one
buildable architecture for the kb agentic-OS month-1 fleet. Repo `C:\Users\danie\kb` is
read-only to this synthesis; all build items land via PR / human-committed governance patches.

> **Provenance note (read first).** The *approvals* research track was flagged for a security
> concern: its trail included investigating whether GitHub's API can set an arbitrary commit
> author while still showing "Verified." This synthesis relies **only** on that track's
> *defensive* conclusion — and it treats the API author-spoofing finding as a **live threat to
> engineer around**, not a technique to use. **Correction carried from adversarial review:** the
> defensive conclusion is *narrower* than "web-flow signatures cannot be forged." GitHub applies
> its `web-flow` GPG signature to **every commit it creates server-side via the REST API**
> (Contents, Merge, etc.), authored as the token's user and shown "Verified." So the web-flow
> signature distinguishes a human browser action from an agent **only if no agent environment
> holds a credential that can reach those REST write endpoints.** That is the load-bearing
> precondition (the *trust-anchor invariant* below), and the gate is unsound without it. Daniel
> should personally read the rewritten `approvals.py` verification logic before it becomes
> load-bearing (Open Question O1).

> **TRUST-ANCHOR INVARIANT (Wave-1, load-bearing — everything downstream depends on it).**
> **No agent environment may hold a credential capable of GitHub REST *contents*/*merge* API
> writes.** All agent git access is **git-transport only**: desktop workers push via an **SSH
> read/write deploy key** (SSH transport cannot call the REST API); the claude.ai cloud routine
> pushes via `git push` over claude.ai's git integration (also git transport — ordinary pushes are
> **not** web-flow-signed). Consequences that the rest of this doc relies on: (a) the **only**
> source of a `web-flow`-signed commit is Daniel's **interactive GitHub browser/mobile session**;
> (b) fine-grained PATs with `Contents: write` are therefore **prohibited in agent environments**
> (a `Contents: write` PAT *can* call the contents API and mint a web-flow signature — see D3/#4);
> (c) the online REST verification path is **removed** from `approvals.py` (it trusts
> `author.login`, the spoofable field — see D1). This invariant is what makes the signed channel a
> real boundary in the interim state, before per-agent GitHub identities exist.

---

## 1. Goal alignment

The ultimate target is a **Jarvis-class, git-native fleet**: a persistent, multi-model agent
organization that discovers, plans, executes, and grades its own work across many projects,
steerable and approvable from Daniel's phone while his PC is off, with git as the single source
of truth and the human as the only trust anchor for consequential action. Month 1 does not build
Jarvis; it **removes the four things blocking the flywheel from turning unattended and safely**:
(1) it hardens the approval boundary so a human tap — not a spoofable git-author string — is what
authorizes action, which is the precondition for *any* non-Claude agent or cloud-only run to be
trusted with ops; (2) it stands up a phone transport (Telegram + GitHub-merge) so approvals,
digests, and wake-me alerts reach Daniel and bind back to his identity without a PC; (3) it
onboards Codex and Gemini as workers behind that hardened boundary, proving the substrate is
model-agnostic; and (4) it closes the grader → promotion loop and the cloud-only execution proof
so autonomy can be *earned and demonstrated* rather than asserted. Everything month 1 ships is a
load-bearing rung on the ladder to the full fleet, and nothing ships that would let an
un-graded, un-authenticated, or non-Claude agent act on protected state before the boundary
that governs it exists.

**Honest scope caveat (from review).** Month 1 does *not* close the shared-owner-credential
attribution hole. It closes it **only for the signed approval record** (via the trust-anchor
invariant + web-flow signature). For grades, standing-auth cadences, the Phase-A worker
credential, the carve-out ledgers, and the STOP/FROZEN kill-switches, the interim state relies on
**detection + hard scoping + the trust-anchor invariant**, not cryptographic prevention. Genuine
per-actor prevention waits on **distinct per-agent GitHub identities** (GitHub accounts / App
identities), which is a **month-2+** item. This doc marks every place that dependency bites.

---

## 2. Decisions (with rationale + conflict resolution)

### D0. THE CENTRAL RECONCILIATION — approvals ↔ transport interface contract

The two tracks were designed to compose. **They do not compose as one interchangeable channel,
and this is the most important thing to get right.** The reconciliation below is a decision, not a
restatement.

**Why they do not directly compose.** The approvals track's hardened trust chain requires the
commit that lands an approval record to be **GitHub `web-flow`-signed** — a signature that, *given
the trust-anchor invariant* (no agent holds a REST-API-capable credential), no agent can produce,
because the only way to obtain one is the interactive GitHub UI backed by Daniel's browser
session. That signature is "the whole gate in the interim" precisely because, today, every agent
pushes as the owner and `enforce_admins` is off, so branch protection alone excludes nobody. The
transport track's Telegram path, however, produces **no such signature**: a phone tap yields an
authenticated `from.id`, and then **the dispatcher (an agent, running with the owner credential)
mints the approval token and pushes it to `ops`.** Under the approvals chain as written, that
agent-authored, unsigned commit is exactly what gets *rejected*. So a Telegram tap cannot satisfy
the web-flow gate. Both researchers independently sensed this — approvals: "the tap must broker
Daniel's interactive GitHub auth, never store a merge-capable token"; transport: "possession ≠
signature; keep novel/first-time T3 on the PR path." The synthesis makes it explicit and binding.

**Resolution — two approval assurance classes, one hash, one card binding:**

| | **Signed channel (high assurance)** | **Possession channel (convenience)** |
|---|---|---|
| Transport | GitHub mobile "Merge" on a pre-staged approval PR | Telegram inline-button tap |
| Identity proof | `web-flow` GPG signature over content, verified **offline** by `approvals.py` against a repo-pinned keyring — **unproducible by any agent under the trust-anchor invariant** | `callback_query.from.id` ∈ allowlist, checked *inside the dispatcher process* |
| Trust rests on | Cryptographic signature bound into git **+ the trust-anchor invariant** | Possession of Daniel's Telegram **+ integrity of the dispatcher process + isolation of the minting host + card-hash match** |
| Admissible for | **All tiers, including novel/first-time T3** (merges, deploys, spend) | **T1/T2 digests + already-earned fast-lane T3 only** — never novel/first-time T3 |
| Fails closed if | keyring missing, unsigned, wrong author, hash mismatch, expired | from.id not allowlisted, hash-prefix mismatch, dispatcher can't verify |

- **The one place they genuinely compose is the hash.** Both channels bind to the *same* I3
  canonical payload — `action` + `target` + `work_order_of(body)` — via the shared
  `approval_payload(card)` function. Same card, same hash; only the identity proof differs. The
  human never types the 64-char hash on either channel: the dispatcher pre-computes it into the
  staged PR (signed channel) or verifies an 8-hex prefix carried in `callback_data` against the
  re-read card (possession channel).
- **Verification is offline-only.** Signed-channel verification is `git verify-commit` against a
  repo-pinned `governance/web-flow.gpg` keyring. **The online REST verification path is removed**
  (it verified `verification.verified` + `author.login ∈ allowlist`, and `author.login` is exactly
  the field the API author-spoof forges). Removing it also removes the need for any agent
  environment to hold a GitHub API token — consistent with, and required by, the trust-anchor
  invariant.
- **The approval record carries an `assurance:` field** (`signed` | `possession`). Downstream
  execution and the weekly audit both read it; a `possession`-class record presented for a
  novel-T3 action is rejected. `approvals.py` exposes two verifiers behind one entry point:
  `verify_signed_approval()` and `verify_telegram_approval()`.
- **Residual trust dependency, stated plainly:** the possession channel's security rests on the
  dispatcher process being uncompromised, because that agent both checks `from.id` and mints the
  token. A compromised dispatcher could forge a possession-approval *without Daniel tapping*. The
  signed channel has no such weakness (the signature is verified independently and cannot be
  minted by the dispatcher). Therefore **anything whose blast radius matters routes through the
  signed channel until per-agent identities + branch protection make the possession channel's
  git-write independently attributable.** This is the resolved cutline; the grader's T3 "fast-lane"
  only ever relaxes an *already-earned, repeatedly-graded* task type to the possession channel.
- **Minting-host isolation invariant (from review #7).** The host that holds the Telegram **bot
  token** and mints possession approvals (2.1) **must never run a cadence that ingests untrusted
  external web content**, and **must never be granted Custom/Full network**. Co-locating
  approval-minting with a prompt-injection surface (e.g. live topic-scouting, O4) would let injected
  content drive possession-approval minting and ops writes. This is a stated invariant, not an open
  question — it constrains the O3 custody choice and forecloses giving the minting host live web
  fetch.
- **No token-custody conflict.** Approvals forbids a *stored, merge-capable GitHub token* in the
  bot (an agent could call it and re-open the boundary). The Telegram **bot token** is a different
  object: it can impersonate the bot (send fake prompts, read the chat) but **cannot fabricate
  `from.id = Daniel`** and **cannot write to `ops`**. So placing the bot token in the dispatcher
  env does not violate the approvals constraint — they are compatible. (Custody location is
  Open Question O3, constrained by the isolation invariant above.)

### D1. Approval mechanism
**Decision:** Rewrite `scripts/approvals.py` around a **signed, protected approval ref** as the
real gate, with the Telegram possession-path layered on top for low-stakes convenience.
- Approval records land at `approvals/<card-id>.yaml` on a **dedicated protected `approvals`
  branch** (keeps `main`/KB content clean; dispatchers must fetch it). Record binds `card`,
  `work-order-hash`, `action`, `target`, `expires`.
- New trust chain (all must hold, fail-closed): (1) record on the protected ref; (2) the
  introducing commit is **web-flow-signed and verified OFFLINE** via a repo-pinned
  `governance/web-flow.gpg` keyring (`git verify-commit` inside a scratch GNUPGHOME) — **no online
  REST path**; (3) approving identity allowlisted (matched against the pinned key's bound
  identity, not a REST `author.login`); (4) recomputed I3 hash matches; (5) `now() < expires` and
  within `MAX_AGE`.
- **Rationale (corrected):** the web-flow signature distinguishes a human GitHub-UI action from an
  agent push **only under the trust-anchor invariant** — because GitHub itself web-flow-signs any
  REST-API commit. With that invariant enforced (agents = git-transport-only, no `Contents: write`
  PAT), an agent can produce commits but **cannot** produce a web-flow signature, so the signature
  remains a sound human-vs-agent discriminator while every agent still shares the owner credential.
  The old `%an` local-git-author check (I1) and the pickaxe `-S` binding (T10) are replaced.
- **Downstream migration is NOT zero-cost (corrected from review).** `routines/nightly.md` step 4b
  **already calls `approvals.py approved_by_human` in production**, and line 19 of that routine
  hard-codes "the approval hash binds only the `## Work order` prose, not frontmatter fields."
  Renaming the entry point to `verify_signed_approval()`/`verify_telegram_approval()` and folding
  `action`+`target` into the hash (I3) makes **both** lines stale; if not updated in lockstep the
  cloud routine calls a nonexistent function (fails closed, but silently stops honoring approvals)
  and its self-documented hash semantics become wrong. A dedicated Wave-1 build item (1.9) updates
  `nightly.md` 4b (new entry-point) and line 19 (hash now binds action+target) in the same change.
- **Layered end-state:** branch protection on `approvals` that **requires PR, requires signed
  commits, and restricts merge to Daniel is a Wave-1 deliverable, NOT deferred** — restrict-merge-
  to-Daniel is part of what distinguishes a human merge from an agent push and must ship with the
  gate (1.6/step 7). `enforce_admins` **on** remains deferred until per-agent scoped identities
  exist (steps 7/23), matching the backlog's "reconsider enforce_admins once agents stop using the
  owner credential." Access-control and signature reinforce each other once both land.

### D2. Transport
**Decision:** A **single Telegram bot** is the primary phone transport for the interactive tier —
possession-class approvals, digests, wake-me alerts (and later Atlas voice / Chief-of-Staff
briefs) — polled by the **existing single heartbeat dispatcher** via `getUpdates`. The **GitHub
approval-PR merge** is the high-assurance channel for novel/first-time T3. **ntfy is dropped**
from the critical path (it carries zero approver identity — structurally incapable of
authenticating a tap). **Omnara/Happy are kept strictly for live desktop-session steering**, never
conflated with git-native approval tokens (their in-session "approve" is a tool-permission prompt,
not a hash-bound token; Omnara's default relay is SaaS).
- **Rationale:** Telegram's `callback_query.from.id` is authenticated by Telegram infrastructure
  and not spoofable by message content — the missing primitive that binds a phone tap to Daniel's
  identity with *no auth stack*, just an id allowlist. It is NAT-friendly (outbound-only, no
  webhook/public IP) and interactive/voice-capable (one transport for everything later).
- **Latency contract (corrected — no daemon means inbound taps are poll-bound).** `sendMessage`
  (outbound: digests, wake-me, approval prompts) is **immediate**. But a possession-**tap is only
  ingested when the dispatcher next runs `getUpdates`** — there is no daemon. Honest contract:
  - **PC on:** a dedicated desktop interactive-poll cadence runs every **~2–5 min** via Task
    Scheduler (short-lived, offset-cursor, STOP-gated), so taps are acted on within minutes.
  - **PC off:** taps wait for the **next scheduled cloud run** (e.g. nightly 02:00), bounded by
    Telegram's **~24 h** server-side retention of undelivered updates. The §D5 daily-run cap means
    the cloud tier cannot poll frequently, so **the possession channel is NOT low-latency in the
    PC-off case** — it is a convenience channel, not an instant one, when the PC is off. Time-
    critical PC-off approvals should use the signed GitHub-merge channel (push notification →
    immediate mobile merge), which is not poll-bound.
  - The interactive-poll cadence (desktop) and the nightly cloud dispatcher **share one `getUpdates`
    offset cursor** on `ops`; the one-poller-per-bot invariant means only one of them polls at a
    time (desktop when PC on; cloud otherwise) — never both concurrently.
- **Invariants:** exactly **ONE poller per bot** (the `getUpdates` offset is global — cloud and
  desktop must never poll concurrently); a **git-native `update_id` cursor** on `ops` for
  idempotency across stateless restarts; STOP-file supremacy (dispatcher never polls when frozen;
  taps wait ≤24h on Telegram's server). `callback_data` ≤64 bytes carries `card_id|decision|
  hash_prefix(8-hex)`; the full I3 hash is verified server-side against the re-read card. The
  minting host obeys the D0 isolation invariant (no untrusted-web ingest, no Custom/Full network).

### D3. Adapter pattern (Codex + Gemini + generic one-off agent)
**Decision:** Onboard **Codex CLI** (ChatGPT-subscription `codex login --device-auth`,
`codex exec`) and **Gemini CLI** (**free-tier API key**, NOT the retired Google login) as
**desktop-tier workers** driven by **preamble-gated Task-Scheduler runner scripts** mirroring
`desktop_dispatch.ps1`. Extend `sync_skills.py` with deterministic `render_codex()` /
`render_gemini()` adapters under the same authoritative-sync + SHA-256 drift-guard model. Route
work via a new **`agent:` field in HEARTBEAT cadences** that `dispatch.py` writes into card
`owner`.
- **Tool-behavior verification gate (from review #6).** Several load-bearing claims here are
  post-January-2026 and drive HUMAN-ACTION credential steps; they are **assumptions to verify
  against current tool docs before the steps that depend on them**, not settled fact. In priority
  order: **(a) that `codex exec` runs headless honoring ChatGPT-subscription auth in
  `~/.codex/auth.json` non-interactively** (the entire Codex leg rests on this and it is otherwise
  unflagged); (b) `codex login --device-auth` exists; (c) the Gemini login-retired-2026-06-18 /
  free-key ~1,500 req/day facts; (d) Antigravity ~20 req/day; (e) the claude.ai "Allow unrestricted
  branch pushes" toggle exists and is the actual I4 fix (D6). A "verify tool behavior" checklist
  item is added at the top of Wave 5 (and Wave 0 for (e)).
- **MATERIAL CORRECTION to the spec:** Gemini's free "Sign in with Google" personal-account path
  was **shut down 2026-06-18**; the CLI now works **only on an API key**. A **free-tier API key
  (no billing, no card)** still exists (~1,500 req/day) and spends no money as long as billing is
  never enabled. The spec §2/§12 "Gemini free via login" assumption is stale (needs a governance
  note, H-corr). Antigravity's free tier (~20 req/day) is non-viable.
- **Phasing (hard-gated by approval hardening):**
  - **Phase A (now, pre-hardening):** both CLIs onboarded **read + own-work-branch push only**
    (`codex/*`, `gemini/*`). **Git access is an SSH read/write deploy key (git-transport only —
    cannot reach the REST API), NOT a `Contents: write` PAT** (per the trust-anchor invariant; a
    `Contents: write` PAT could mint a web-flow signature and reach every non-protected branch — see
    #4). The **branch restriction is enforced by a GitHub push ruleset** (Phase-A HUMAN-ACTION
    prerequisite) that **blocks direct pushes to `ops` and `main`** — *the deploy key / PAT scope
    does NOT restrict by branch prefix on its own.* Workers execute cards a Claude/human dispatcher
    placed on `ops`, commit to their work branch; a Claude agent or human relays `## Result` back
    onto `ops`. **No ops-write credential exists for them.** This delivers real work value with zero
    ops-write, so onboarding is *not* blocked on hardening — only their autonomy is.
    - *Residual interim limitation (honest):* because Phase-A workers still authenticate as the one
      owner account, a push ruleset's *actor* bypass cannot distinguish a worker from Daniel; the
      Phase-A ruleset therefore relies on **blocking direct `ops`/`main` pushes for the owner path
      too (require-PR)**, which is compatible with the normal dispatcher flow (dispatcher/relay
      commits are the only legitimate ops writers and run on trusted hosts). Full actor-scoped
      restriction awaits per-agent GitHub identities (month-2+).
  - **Phase B (only after I1+I3 land on `main`):** grant the scoped ops-push path (still a deploy
    key, git-transport only); work stays `queues-for-me` until grades promote per task-type.
- **Runner-level billing guards** (model can't self-gate):
  - **Codex (enforceable):** assert `OPENAI_API_KEY`/`CODEX_API_KEY` **unset** + `~/.codex/auth.json`
    present. Asserting the API-key env unset **does** close Codex's metered-fallback money path —
    this is a real runtime guard, the analogue of the `ANTHROPIC_API_KEY` trap.
  - **Gemini (NOT a mechanical guard — corrected).** The free key and a billed-project key are the
    **same object**; enabling billing on the backing Google Cloud project is a server-side change
    **invisible to the runner**. There is no local signal to assert on, so "assert billing-free key"
    reduces to "a key is present" and **cannot prevent spend**. Gemini's no-spend property therefore
    rests on a **human-maintained invariant — Daniel never enabling billing on that project** — plus
    periodic human/observable verification (O5), **not** a runtime gate. If a hard guard is wanted,
    pin a known project-id and refuse unknown ones, or probe a known over-limit condition — but none
    of these is airtight; do not present Gemini as equivalent to the `ANTHROPIC_API_KEY` trap.
  - Tokens/keys delivered via **credential helper** (Windows Credential Manager) or SSH agent, never
    read as an object; deny-rule on the store path (audited at Phase A go-live).
- **Rationale:** keeps the single-scheduler/claim purity (dispatcher assigns, runners execute),
  lets STOP/preamble gate each runner independently, and makes future CLI agents join by filling a
  reusable template (`docs/onboarding/one-off-agent.md`) instead of re-deriving the pattern.

### D4. Grader enforcement
**Decision:** Build a **grader (Inspector) identity + grade-row schema + grading rubric +
`promotion.py` + `reconcile.py`**, wire `promotion.decide()` into `dispatch.py`, and add two
governance artifacts (grader allowlist + dashboard-regen carve-out). Enforcement of "only the
grader writes grades" is **reconciliation-as-detection in v1**, with a GitHub **push ruleset** on
`ledgers/grades/**` as the documented hardening once per-agent GitHub identities exist.
- **Threat model, stated honestly (corrected from review #2/#5-feasibility).** v1 reconciliation is
  **robust only against non-adversarial drift and buggy workers — it is NOT robust against a
  malicious or prompt-injected worker that knows the scheme.** The Inspector's identity is a
  git-config author string (`inspector@agents.local`) on the shared, agent-writable `ops` branch,
  and `reconcile.py` cross-checks grade rows against the Inspector's `ledgers/activity/` commits —
  authored by the *same* forgeable string on the *same* branch. A worker that runs
  `git config user.email inspector@agents.local` can write a passing grade row **and** a matching
  activity row; reconciliation sees a matched pair and does not FROZEN. So the "belt-and-suspenders"
  is, in v1, the same forgeable belt on both sides, and the detection window (O6) is not the only
  gap — the check itself is spoofable. **This is not presented as meaningful prevention against an
  insider/injected worker.** What actually protects grade integrity in the interim:
  - **T3 is permanently capped** at human-token (risk-tiers.md binding) — a forged grade cannot make
    T3 act alone.
  - **AGENT-GENERATED task types default to `queues-for-me`** regardless of grade (risk-tiers.md).
  - **The `promotion.decide()` "autonomous" branch is only trusted to the degree its grade inputs
    are** — so autonomous acts-alone for **non-Claude workers is treated as advisory-integrity in v1
    and gated behind the same identity hardening that gates their ops access** (Wave 5.9 note).
  - **Real prevention** = the `ledgers/grades/**` push ruleset (3.9), which is a **prerequisite for
    trusting autonomous grade-driven promotion**, deferred only because it needs per-agent GitHub
    identities (month-2+). Until it lands, grade-driven promotion is not tamper-resistant and the
    doc says so.
- **Why detection, not prevention, now:** `ops` is direct-push (no PRs → CODEOWNERS never fires);
  a push ruleset restricting `ledgers/grades/**` to a grader bypass identity is the correct
  preventive tool **but is unusable until per-agent GitHub identities separate grader from worker**
  (today all agents push as the one owner account). So v1 uses the weekly audit to cross-check every
  grade row against the Inspector's `ledgers/activity/` commits; unmatched rows → quarantine + write
  `ledgers/grades/FROZEN` + wake-me card; `decide()` forces `queues-for-me` while frozen — with the
  spoofability caveat above.
- **Grade-row schema + rubric are explicit deliverables (from review, completeness #5).** The
  promotion loop keys on grade rows whose shape must be pinned: `{worker, project, task_type, tier,
  card_id, score(0–100), pass(bool), rubric_version, inspector_id, ts}` (3.3), plus a documented
  **Inspector rubric** (scored dimensions: correctness, scope-adherence, evidence-quality, safety/
  constraint-compliance — pass/floor bars per risk-tiers.md) that the Inspector skill scores against
  (3.5). These are not left implicit in `promotion.py`.
- **Promotion rule** (`promotion.status`, pure, recomputed — no stored state to tamper): for
  `(worker, project, task_type, tier)`, autonomous iff **not frozen** AND graded-run count ≥ window
  (T1 10 / T2 20 / T3 40) AND none of the last `window` runs below the tier pass-bar (T1 90 / T2 95
  / T3 98) AND none below the demotion floor (T1 80 / T2 90 / T3 any-fail; below-floor resets the
  counter). **T3 is capped:** even when the bar is met, `decide()` returns
  `queues-for-me (fast-lane)` — T3 never acts alone without a human token in v1 (risk-tiers.md is
  binding). "Fast-lane" = eligible for the **possession channel** (D0), not autonomous execution.
- **`decide()` precedence:** FROZEN → queues-for-me; else standing-authorized (dashboard-regen
  carve-out, or **verified** human-authored cadence — see next bullet) → acts-alone (T1/T2) /
  fast-lane (T3); else status==autonomous → acts-alone/fast-lane; else queues-for-me (v1 default).
  Dispatcher stamps an `autonomy:` field and routes acts-alone→`inbox/`, queues-for-me→`approvals/`.
- **Standing-authorization must be authenticated, not read from the ops working tree (corrected from
  review #3).** risk-tiers.md scopes the standing authorization to "a cadence a human authored and
  committed to a HEARTBEAT.md on **protected `main`**." But `decide()` reads HEARTBEAT.md from the
  **ops working tree**, whose content is identical whether Daniel committed it to `main` or a
  compromised worker injected it into `ops` (and HEARTBEAT.md is **not** in the constitution's
  human-only set — only `governance/` and `CLAUDE.md` are). So the standing-auth carve-out is a
  self-grant path to acts-alone unless authorship is verified. **Fix (Wave-4 build item):**
  `decide()` honors the standing-auth branch for a cadence **only if that exact cadence block is
  present on the `main` ref** (`git show main:<heartbeat-path>` cross-check) — i.e. it was
  human-committed to the human-only-writable `main`, never merely present in the ops tree. (Agents
  never push `main` per the constitution, so main-presence is a genuine human-authorship signal in
  v1; a cryptographic per-author signature replaces it once per-agent identities exist.) Until this
  cross-check ships, the standing-auth branch must **not** grant acts-alone.
- **Grade integrity placement:** run the **Inspector on the desktop tier** with a real distinct
  `inspector@agents.local` git identity — because **cloud routine commits all carry Daniel's GitHub
  identity** (see D6), which would make cloud grade-author indistinguishable from worker/human.
  **`reconcile.py` is pinned to the desktop tier for the same reason** (corrected from review,
  completeness #2): it cross-checks grade rows against Inspector git-authorship, which is meaningless
  in the cloud tier where every commit is Daniel's identity. The **weekly `grades-reconcile`
  cadence** (3.10) is therefore declared `--tier desktop`.
- **STOP/FROZEN kill-switch integrity (corrected from review #6).** `reconcile.py` writes
  `ledgers/grades/FROZEN` and `decide()` honors it, but in v1 FROZEN lives on agent-writable `ops`,
  so a frozen-and-compromised worker can `rm` it and push. Interim treatment: (a) **document that
  FROZEN/STOP integrity depends on the trust-anchor invariant + per-agent identity hardening, and
  that no non-Claude worker may have write access to their location**; (b) place the **FROZEN
  sentinel on the protected `approvals` (or a dedicated protected `grades`) ref** where feasible so
  its deletion is an authenticated action, and have `reconcile.py` re-assert FROZEN (and wake-me) if
  it detects the sentinel was cleared without an authenticated clear-record; (c) the **STOP file**
  (preamble check) similarly depends on only a trusted party being able to set/clear it — recorded
  as an interim risk until STOP lives on a location no worker can write. This is detection +
  documentation in v1, prevention once identities land.
- **Dashboard-regen carve-out** (resolves the live `memory/dispatcher-cloud.md` nightly-in-approvals
  deadlock): `dashboard-regen` standing-authorized at **T1 acts-alone** for any trigger, scoped
  exhaustively to writes under `dashboards/**`, own-shard `memory/<agent-id>.md`, and an
  **enumerated allow-list of NON-integrity ledgers only**. **The carve-out text MUST exclude
  `ledgers/grades/**` and `ledgers/activity/**` (and any other integrity ledger)** (corrected from
  review #5): a blanket `ledgers/**` scope would let an injected dashboard-regen run *append* a
  forged grade+activity pair **within** its authorized scope, defeating "only the grader writes
  grades." Any write outside the enumerated scope voids the carve-out → reverts to queues-for-me.
  Human-committed patch to `governance/risk-tiers.md` (exact text supplied by the grader track,
  **with the grades/activity exclusion written in verbatim**).

### D5. Role model
**Decision:** Scout → Manager → Worker → Inspector are **card STAGES + prompt-templates, never
schedulers.** `dispatch.py` stays the *only* clock; the single-scheduler rule governs *scheduling*,
not *execution*. Roles are expressed as (a) an extended `role` field
(`scout|manage|work|inspect|consolidate`) and (b) four prompt templates the executor adopts per
card, each with its own model tier, wired as a **card DAG released by the dispatcher's `depends-on`
logic** (the keystone month-1 build gap).
- Two card provenances: **human-authored cadence** (dispatcher mints a `role: work` card directly,
  standing-authorized at declared tier **subject to the D4 main-ref authorship cross-check**; the
  human *is* the Manager) + optional `role: inspect` sibling so it earns a grade; **agent-discovered
  work** (Scout=Haiku read-only files findings into inert `## Evidence` → Manager=Opus writes real
  work orders + sets action/target/risk-tier → Worker=Sonnet/Codex/Gemini executes on an agent
  branch → Inspector=Opus fresh-context grades). Dispatcher ≠ Manager: dispatcher is the mechanical
  claim-minter.
- **Git identity per role (scoped claim — corrected, completeness #9).** The load-bearing
  authorship-attribution identity is the **Inspector's** (`inspector@agents.local`, 3.8) — it is the
  only one where a distinct git author is a *grade-integrity* signal. Scout/Manager/Worker are named
  in prompt templates (4.3) for provenance labeling but are **git-author tags on the shared owner
  account, not independently attributable identities**; the doc does not claim they are. (Distinct
  per-agent GitHub identities for all roles are month-2+.)
- **≥3 projects:** keep `orgs/faceless-youtube` (content-media) + scaffold `orgs/kb-ops` (self-ops,
  the fastest safe path to the **first real T1 grades** — sequence it first to bootstrap the grade
  ledger) + `orgs/atlas-prep` (research, exercises the Gemini large-context worker + T2 bar).
- **First faceless-youtube cadence (scope note — completeness #4).** Month 1 ships only the weekly
  `idea-backlog-refresh` for the-second-take (T2, cloud): upstream of every human gate, **no
  content-producing / publishing cadence and no external side effect** — it writes re-scored briefs
  to a `claude/*` branch + draft PR (idea-backlog.md is under `channels/`, NOT in contract
  acts-alone), stops at the human idea gate, never sets `picked`. **This reads backlog line 18's
  "first real faceless cadence" as "first real cadence *mechanism*," not "first real *content
  output*."** Any content-producing/publishing faceless cadence is deferred to §5. **Open question
  O10** asks Daniel to confirm this satisfies the backlog intent.
- **Tiered heartbeats compose by UNION under one dispatcher:** ONE cloud dispatcher run scans root
  `kb` + all `orgs/*/HEARTBEAT.md` and emits every due cloud cadence across all projects in a
  *single* run (N projects = 1 routine run, not N — critical vs. the daily-run cap); ONE desktop
  dispatcher does the same for `--tier desktop`. Projects DECLARE cadences; the one dispatcher
  SCHEDULES. Do **not** create one routine per project. Also fold in the deferred `cards.py`
  role-enum validation alongside the schema change.
- **Tier-partition safety (double-emit / silent-drop guard — corrected from review #10).** The
  "single scheduler" invariant becomes "cloud dispatcher + desktop dispatcher partitioned by a
  cadence `tier` field." Canonical rule, **fail-closed:** each cadence declares exactly one tier ∈
  `{cloud, desktop}`; a cadence with a **missing/invalid/unknown tier is NOT scheduled by either
  dispatcher and raises a wake-me card** (never emitted by both → no duplicate execution / double
  approvals; never silently dropped). A test asserts **no cadence is claimable by both dispatchers**
  and that an unknown-tier cadence is skipped-with-wake-me (added to `test_dispatch.py`).

### D6. Cloud-leg fix (I4)
**Decision:** The root cause is understood to be (VERIFY against current Claude Code routines docs —
see Wave-0 tool-behavior gate): a routine by default **can only push to `claude/`-prefixed
branches**; the nightly routine does `git checkout ops … git push origin ops`, so the push to `ops`
(a non-`claude/` branch) is **blocked by default**. Secondary latent failures: private-repo clone
access not granted; `pyyaml` missing in the VM; **`gpg` availability not established** in the VM.
- **Fix = human UI actions at claude.ai** (repo access + branch permission are identity/credential
  steps): grant clone access to private `kb`; **enable "Allow unrestricted branch pushes" for
  `kb`**; set env (Network=Trusted, setup script installs **`pyyaml` and ensures `gpg` is present**,
  connectors off); configure the routine ("Read `routines/nightly.md` and follow it exactly", daily
  02:00). Agent side: add a `pyyaml` fallback/step to `routines/nightly.md`.
- **Cloud approval-honoring must be proven runnable, not assumed (corrected from review, feasibility
  #1).** `routines/nightly.md` 4b has the **cloud** dispatcher verify approvals. With the online REST
  path removed (D1), the cloud tier must verify **offline** via `git verify-commit` against the
  pinned keyring — which requires the **`gpg` binary present in the cloud VM** and the pinned
  `governance/web-flow.gpg` importable into a scratch GNUPGHOME. A verification item (0.5) requires a
  cloud run to **verify one signed approval end-to-end** before Wave 1 is called done; if the cloud
  VM cannot run `git verify-commit`, **approval-honoring is desktop-only** and that limitation is
  recorded (it would gate the PC-off flywheel promise).
- **Cloud git access is git-transport, not REST-API (ties to trust-anchor invariant).** The cloud
  routine's `git push` over claude.ai's git integration is git transport; ordinary pushes are **not**
  web-flow-signed, so the cloud tier cannot mint a web-flow signature via normal operation. The
  invariant's prohibition is specifically on any REST `Contents`/`Merge` API credential in an agent
  env — none is provisioned for the cloud routine.
- **Governance-critical fact carried forward:** cloud routine commits carry **Daniel's GitHub
  identity**, not an agent identity — which is *why* the grader/Inspector, `reconcile.py`, and any
  git-author-based approval honoring must stay on the **desktop tier** until I1/I3 verified-identity
  hardening lands (a cloud commit is otherwise indistinguishable from a genuine human approval
  commit). This is the same shared-owner-credential root hole that D0/D1 solve with the web-flow
  signature + trust-anchor invariant.
- **Verification checklist for a demonstrated cloud-only cycle:** Run-now → green status →
  **open transcript** (green ≠ success); on desktop confirm fresh
  `ledgers/dispatch/dispatcher-cloud-<today>.tsv`, regenerated `dashboards/executive.md` +
  `handover.md` (today's date — **requires the dashboard-regen carve-out already committed and merged
  to the ops tree**, see Wave-0 ordering), the cadence card in `queue/done/` with a `## Result`;
  confirm the ops-advancing commit was **authored in the cloud** (author/timestamp vs run time), that
  Task Scheduler `kb-desktop-dispatcher` stayed Disabled, and that the push landed on `ops` directly.

---

## 3. Build inventory (dependency-ordered, tagged)

**Ordering law:** (i) approvals hardening (I1+I3+T10) lands on `main` BEFORE any non-Claude agent
gets ops access; (ii) all `governance/` and `CLAUDE.md`/spec changes are **human-committed
proposals** — agents may only PROPOSE patches; (iii) **no agent handles a credential as an object**
(create/read-store/modify) — every token/identity/branch-permission step is HUMAN-ACTION; (iv) **the
trust-anchor invariant holds — no agent environment is provisioned with a REST-API-capable
(`Contents: write`) credential; agents use git-transport-only access (SSH deploy key / claude.ai git
integration).**

### Wave 0 — Cloud-leg proof + carve-out (unblocks the running loop; no ordering deps)
*Ordering corrected (completeness #3): the dashboard-regen carve-out (0.4) must be committed AND
merged into the ops tree BEFORE the Run-now verification (0.5), or the nightly dashboard-regen
queues into `approvals/` instead of acting alone and the "regenerated dashboards (today's date)"
verification criterion fails.*
| # | Artifact | Tag |
|---|---|---|
| 0.1 | **Verify tool behavior:** confirm the claude.ai "Allow unrestricted branch pushes" toggle exists and is the I4 fix (vs. current routines docs) | HUMAN-ACTION (doc check) |
| 0.2 | claude.ai routine: clone access to `kb`, **"Allow unrestricted branch pushes"**, env (Trusted + setup script installs `pyyaml` **and ensures `gpg`** + connectors off), schedule/prompt | **HUMAN-ACTION** |
| 0.3 | `routines/nightly.md`: pyyaml fallback step; confirm targets `ops` | AGENT-BUILDABLE (PR) |
| 0.4 | `governance/risk-tiers.md` dashboard-regen carve-out (exact text from grader track, **grades/activity ledgers excluded verbatim**) — commit on `main`, **merge into ops before 0.5** | **HUMAN-ACTION** (human commits verbatim on `main`) |
| 0.5 | Run cloud-only verification checklist (D6), **including verifying one signed approval offline (`git verify-commit`) end-to-end in the cloud VM** | HUMAN-ACTION |

### Wave 1 — Approval-boundary hardening (I1 + I3 + T10) — GATES Waves 3–5's ops access
| # | Artifact | Tag |
|---|---|---|
| 1.1 | `approval_payload(card)` — canonical deterministic serialize of `action`+`target`+`work_order_of(body)` (I3); shared by verifier + PR-minter | AGENT-BUILDABLE |
| 1.2 | Rewrite `scripts/approvals.py`: signed-protected-ref **offline** verification (`git verify-commit` against pinned keyring; **online REST path removed** — it trusted spoofable `author.login`), two entry points `verify_signed_approval()` / `verify_telegram_approval()`, `assurance:` field; keep `verdict()`'s pure shape | AGENT-BUILDABLE |
| 1.3 | Offline web-flow verify wrapper (import `governance/web-flow.gpg` into scratch GNUPGHOME; requires `gpg` present) | AGENT-BUILDABLE |
| 1.4 | Dispatcher pre-staging helper: on card→`approvals`, compute hash + open PR `approval/<card-id>`→approval ref (agent opens, cannot merge) | AGENT-BUILDABLE |
| 1.5 | Tests: I3 hash covers action+target; **T10** main→ops merge topology binds to true signing commit; **T10** `git show <sha>:<path>` frontmatter-field assertion; unsigned/agent-pushed→reject; expiry+future-date; forged author w/o signature→reject; **keyring-missing→fail-closed (not skip→pass)** | AGENT-BUILDABLE |
| 1.6 | Provision protected `approvals` branch: require PR, require signed commits, **restrict merge to Daniel (NOT deferred — part of the human-vs-agent discriminator)**; `enforce_admins on` deferred to after per-agent identities | **HUMAN-ACTION** |
| 1.7 | Import + pin `governance/web-flow.gpg` (fp `968479A1AFF927E37D1A566BB5690EEEBB952194` + prior published keys); set rotation-refresh checkpoint | **HUMAN-ACTION** (trust anchor = human decision) |
| 1.8 | `governance/humans.yaml`: add GitHub login(s) + verified email(s); annotate bare author names as advisory | **HUMAN-ACTION** |
| 1.9 | **`routines/nightly.md` migration (in lockstep with 1.2):** update step 4b to the new entry-point name (`verify_signed_approval`); update line 19 note ("hash binds only `## Work order` prose") to reflect I3 (hash now binds `action`+`target`+work-order) | AGENT-BUILDABLE (PR) |
| 1.10 | **Trust-anchor invariant enforcement:** audit every agent environment (desktop runners, cloud routine) confirms **no `Contents: write` PAT / REST-API-capable token** is present; desktop workers use SSH deploy keys; record the invariant in `governance/security-rules.md` (agent may PROPOSE) | **HUMAN-ACTION** |

*Wave-1 exit criterion (H-gate): 1.1–1.10 merged/verified before any ops-push credential is minted
for a non-Claude agent.*

### Wave 2 — Transport (Telegram bot: possession approvals + digests + wake-me) — DEPENDS ON 1.1–1.2
*Wave 2 consumes `approval_payload` (1.1), `verify_telegram_approval()`, and the `assurance:` field
(1.2); it cannot function before those exist (dependency made explicit per completeness #8).*
| # | Artifact | Tag |
|---|---|---|
| 2.1 | `scripts/telegram_poll.py` — `getUpdates(offset)`, filter `callback_query`/`message`, verify `from.id`∈allowlist, parse `callback_data`, re-read card + verify full I3 hash vs prefix, mint possession-approval (`assurance: possession`) → `queue/approvals/`, `answerCallbackQuery`+`editMessageText`, advance offset; STOP-gated via preamble; **runs only on the isolation-invariant host (no untrusted-web ingest, no Custom/Full network)** | AGENT-BUILDABLE |
| 2.2 | `scripts/telegram_send.py` — `sendMessage`/inline-keyboard helper (`callback_data=card_id|decision|hash_prefix`) | AGENT-BUILDABLE |
| 2.3 | git-native `update_id` cursor file on `ops` + `ledgers/approvals/telegram-<date>.tsv` audit | AGENT-BUILDABLE |
| 2.4 | Notify-intent wiring (card→`approvals`, or wake-me trip → one send path) + digest formatter (mission-control/morning brief → Telegram) | AGENT-BUILDABLE |
| 2.5 | Rehearsal harness: STOP halts polling; offset idempotent across restarts; non-Daniel `from.id` rejected; hash-mismatch quarantines card | AGENT-BUILDABLE |
| 2.6 | **Desktop interactive-poll cadence** (~2–5 min via Task Scheduler, `--tier desktop`, STOP-gated) sharing the one `getUpdates` offset — defines the PC-on latency contract (D2) | AGENT-BUILDABLE |
| 2.7 | Create bot via **@BotFather** (mints bot token); capture Daniel's Telegram `user_id`; lock bot (`/setprivacy`, no group joins, single private chat) | **HUMAN-ACTION** (credential creation) |
| 2.8 | Place bot token in chosen dispatcher host env (never in repo); add `api.telegram.org` to cloud Trusted allowlist. **Do NOT add `api.github.com` for an online web-flow path — that path is removed (D1); no GitHub API token belongs in any agent env (trust-anchor invariant).** | **HUMAN-ACTION** |
| 2.9 | `governance/humans.yaml`: add `telegram_id` allowlist entry | **HUMAN-ACTION** (agent may only PROPOSE) |

### Wave 3 — Grader + promotion loop (needs Wave 0.4 carve-out; prevention hardening needs per-agent identities)
| # | Artifact | Tag |
|---|---|---|
| 3.1 | `scripts/promotion.py` — `status()` + `decide()` (reads grades ledger + FROZEN + `graders.yaml`; standing-auth branch requires the **main-ref cadence cross-check**, D4); pure/testable | AGENT-BUILDABLE |
| 3.2 | `scripts/reconcile.py` — weekly grades-vs-activity cross-check, FROZEN writer, quarantine report, wake-me emitter (reuses approvals pickaxe); **desktop-tier only** (author cross-check meaningless in cloud); re-asserts FROZEN if sentinel cleared without an authenticated record | AGENT-BUILDABLE |
| 3.3 | `scripts/grade.py` (or documented `ledger.append(...,"grades",...)` convention) + paired `ledgers/activity/` append; **pins the grade-row schema** `{worker,project,task_type,tier,card_id,score,pass,rubric_version,inspector_id,ts}` | AGENT-BUILDABLE |
| 3.4 | `dispatch.py` edit — call `promotion.decide()` per cadence; add `autonomy:` field; route queues-for-me→`approvals/` | AGENT-BUILDABLE |
| 3.5 | Inspector skill/role doc under `skills/curated/` (fresh-context grader; emits grade row + activity row **against an explicit rubric — correctness / scope-adherence / evidence-quality / safety-compliance, bars per risk-tiers.md**) — must pass `scan_skill.py` + human read-through | AGENT-BUILDABLE |
| 3.6 | Tests: `test_promotion.py` (bar/floor/window/T3-cap/freeze/**standing-auth main-ref cross-check**), `test_reconcile.py` (clean/fabricated/wrong-grader/missing-activity→FROZEN+wake-me), `test_dispatch.py` (acts-alone→inbox, queues→approvals, carve-out **excludes grades/activity ledgers**, frozen, **unknown-tier→skip+wake-me / no double-claim**) | AGENT-BUILDABLE |
| 3.7 | `governance/graders.yaml` — grader allowlist (`inspector`) | **HUMAN-ACTION** (agent may PROPOSE) |
| 3.8 | Inspector git identity (`inspector@agents.local`) config on **desktop tier** | AGENT-BUILDABLE (git config only; no token) |
| 3.9 | GitHub push ruleset on `ledgers/grades/**` restricting writes to grader bypass identity — **the only real prevention of grade tampering; a prerequisite for trusting autonomous grade-driven promotion** | **HUMAN-ACTION, DEFERRED** until per-agent GitHub identities (month-2+); until then autonomous promotion is not tamper-resistant (see D4 threat model) |
| 3.10 | **Weekly `grades-reconcile` cadence in root `HEARTBEAT.md`** (`--tier desktop`, e.g. `weekly:sat`) that actually runs `reconcile.py`; **confirm it emits FROZEN + wake-me on unmatched rows** — without this the detection model is inert (completeness #1) | AGENT-BUILDABLE (cadence is data; human authors/commits the HEARTBEAT entry on `main`) |

### Wave 4 — Role model + ≥3 projects + first faceless cadence (execution model; ops-push for non-Claude gated by Wave 1)
| # | Artifact | Tag |
|---|---|---|
| 4.1 | `dispatch.py`: **`depends-on` release logic** (release child only when deps `done`, thread their `## Result` in) — the DAG keystone | AGENT-BUILDABLE |
| 4.2 | `dispatch.py`: emit role-tagged cards (per-cadence `role:` default `work` + optional auto `inspect` sibling); set card `role` + role identity `owner`; **standing-auth cadence honored only if present on `main` ref (D4 cross-check)** | AGENT-BUILDABLE |
| 4.3 | `routines/roles/{scout,manager,worker,inspector}.md` prompt templates (model tier, read/write scope, identity, mandate) | AGENT-BUILDABLE |
| 4.4 | `cards.py`: add `role` enum validation (`scout|manage|work|inspect|consolidate`) — folds in deferred minor | AGENT-BUILDABLE |
| 4.5 | Scaffold `orgs/kb-ops/` + `orgs/atlas-prep/` via `new_project.py`; author conservative HEARTBEAT cadences (each with an explicit `tier`) + contracts | AGENT-BUILDABLE |
| 4.6 | `orgs/faceless-youtube/HEARTBEAT.md`: add `idea-backlog-refresh` cadence (T2, cloud, claude/-branch+draft-PR, stop at idea gate; **no content output — see O10**) | AGENT-BUILDABLE |
| 4.7 | `governance/card-schema.md`: extend `role` enum | **HUMAN-ACTION** (agent may PROPOSE) |

### Wave 5 — Non-Claude worker onboarding (Codex + Gemini) — HARD-GATED behind Wave 1 exit for ops-push
| # | Artifact | Tag |
|---|---|---|
| 5.0 | **Verify tool behavior (gate, from review #6):** confirm against current tool docs — esp. **`codex exec` runs headless honoring ChatGPT-subscription auth in `~/.codex/auth.json` non-interactively** (whole Codex leg depends on it); also `codex login --device-auth`, Gemini login-retired / free-key ~1,500 req/day, Antigravity ~20 req/day | HUMAN-ACTION (doc check) |
| 5.1 | `sync_skills.py`: `render_codex()`/`render_gemini()` adapters → `.codex/skills-catalog.md`, `.gemini/skills-catalog.md` + SHA-256 into `MANIFEST.json` (drift-guarded) | AGENT-BUILDABLE |
| 5.2 | `dispatch.py`: optional `agent:` cadence key → `cards.claim(card, agent)` (backward-compatible) | AGENT-BUILDABLE |
| 5.3 | `scripts/agent_runner.ps1` (param `-Agent codex-worker|gemini-worker`): pin interpreter → checkout/pull ops → preamble → runner billing guards (**Codex: assert `OPENAI_API_KEY`/`CODEX_API_KEY` unset — enforceable; Gemini: no mechanical guard, human-maintained billing-off invariant + note, O5**) → scan owned cards → `codex exec -` / `gemini -p @<card>` → write `## Result` on `codex/*`/`gemini/*` branch → log model id from `--json` to `ledgers/cost/` → re-check STOP between cards | AGENT-BUILDABLE |
| 5.4 | `.codex/config.toml` + `.gemini/settings` (workspace-write, conservative approval, network off, secret-path deny-rules) | AGENT-BUILDABLE |
| 5.5 | `docs/onboarding/one-off-agent.md` — reusable onboarding checklist (SSH deploy key + push ruleset pattern) | AGENT-BUILDABLE |
| 5.6 | Adapter/runner tests (dispatch routing, sync drift incl. new catalogs, preamble-gate→no CLI invocation) | AGENT-BUILDABLE |
| 5.7 | Install + first-login each CLI: `codex login --device-auth`; create **free-tier** Gemini API key (no billing) | **HUMAN-ACTION** |
| 5.8 | **Phase A worker git access:** provision an **SSH read/write deploy key** on `kb` for the desktop workers (git-transport only — **NOT a `Contents: write` PAT**, per trust-anchor invariant); **provision a GitHub push ruleset that blocks direct pushes to `ops` and `main`** (require-PR) — *the deploy-key/PAT scope does NOT restrict by branch prefix; the ruleset is what enforces it*; store key via SSH agent / credential helper, never as an object; deny-rule audit | **HUMAN-ACTION** |
| 5.9 | **Phase B** (only after Wave 1 on `main`): grant the scoped **ops-push** path (SSH deploy key, git-transport only); register `codex-worker`/`gemini-worker` in governance identity list; keep task types `queues-for-me` until graded. **Note:** these are still owner-account-scoped; true per-agent GitHub identity separation (and thus tamper-resistant grade-driven autonomous promotion) is month-2+ | **HUMAN-ACTION** |
| 5.10 | Register Task Scheduler tasks `kb-codex-runner`, `kb-gemini-runner` (Disabled until Phase A go-live) | **HUMAN-ACTION** |
| 5.11 | Governance/spec correction: "Gemini free via Google login" → "Gemini CLI + free-tier API key (login retired 2026-06-18); **billing must never be enabled — this is a human-maintained invariant, not a runtime guard**" | **HUMAN-ACTION** |

### Wave 6 — Session steering (orthogonal; optional, low priority)
| # | Artifact | Tag |
|---|---|---|
| 6.1 | Omnara **or** Happy install/auth for phone launch/steer of desktop tier (both $0/open-source; Omnara default relay is SaaS — self-host if boundary-adjacent). Kept strictly for session steering, never approvals | **HUMAN-ACTION** |

---

## 4. Human-action checklist (in order, exact)

**Phase 0 — Cloud-leg proof (do first; unblocks the running loop)**
1. **Verify** the claude.ai "Allow unrestricted branch pushes" toggle exists / is the I4 fix
   (current routines docs).
2. **claude.ai → routine `kb-nightly-dispatcher`:** connect/grant clone access to the private `kb`
   repo only (`/web-setup` or the routine form).
3. **Same routine → Permissions:** enable **"Allow unrestricted branch pushes" for `kb`** (this is
   the I4 fix — without it `git push origin ops` fails).
4. **Same routine → Environment:** Network = **Trusted** (Custom/Full only for a cadence that needs
   arbitrary web AND is NOT the approval-minting host); **Setup script** = install `pyyaml` **and
   ensure `gpg` present**; **Connectors: remove all**.
5. **Same routine:** Repositories = `kb`; schedule daily 02:00 local; prompt = "Read
   `routines/nightly.md` and follow it exactly"; model selector = intended dispatcher model.
6. **Commit the dashboard-regen carve-out** to `governance/risk-tiers.md` verbatim (grader-track
   text, **grades/activity ledgers excluded**) on `main`, **and merge it into the `ops` tree** —
   this must happen BEFORE step 7 or the nightly dashboard-regen will queue into `approvals/`
   instead of acting alone.
7. Trigger **Run now**, confirm green, **open the transcript**, then run the D6 verification
   checklist on desktop (fresh dispatch ledger, regenerated dashboards, card in `done/`,
   cloud-authored ops commit, desktop task stayed Disabled), **and confirm the cloud VM can verify
   one signed approval offline via `git verify-commit`** (else record approval-honoring as
   desktop-only).

**Phase 1 — Approval-boundary hardening (gates all non-Claude ops access)**
8. **Enforce the trust-anchor invariant:** audit that **no agent environment holds a
   REST-API-capable (`Contents: write`) GitHub token**; desktop workers will use SSH deploy keys;
   record the invariant in `governance/security-rules.md`.
9. Provision the protected **`approvals` branch**: require PR, require signed commits, **restrict
   push/merge to Daniel (do NOT defer this)**. (Leave `enforce_admins` **off** for now.)
10. Import + pin **`governance/web-flow.gpg`** (fingerprint
    `968479A1AFF927E37D1A566BB5690EEEBB952194` plus prior published web-flow keys from
    `https://github.com/web-flow.gpg`); note a key-rotation refresh checkpoint.
11. Edit **`governance/humans.yaml`**: add Daniel's GitHub login(s) + verified email(s); annotate
    bare author names as advisory only.
12. Review + commit the rewritten **`approvals.py`** PR (Open Question O1 — read the verification
    logic personally; confirm the **online REST path is removed** and keyring-missing fails
    **closed**) **and the paired `routines/nightly.md` 4b/line-19 migration**. This merge to `main`
    is the **gate** for steps 22–23.

**Phase 2 — Transport**
13. **@BotFather:** create the bot (mints the bot token); capture your own Telegram `user_id`;
    `/setprivacy`, disable group joins, restrict to your single private chat.
14. Place the **bot token** in the chosen dispatcher host env (decide O3: cloud Routine env vs
    desktop OS credential manager) — never in the repo. **One poller per bot** (never poll from
    both hosts). **The chosen host must obey the isolation invariant** (no untrusted-web ingest, no
    Custom/Full network).
15. Add `api.telegram.org` to the cloud **Trusted** network allowlist. **Do NOT add
    `api.github.com`** — the online web-flow path is removed and no GitHub API token belongs in an
    agent env.
16. Commit the **`telegram_id`** entry in `governance/humans.yaml` (from the agent-proposed patch).

**Phase 3 — Grader + governance**
17. Commit **`governance/graders.yaml`** (`inspector`) from the agent-proposed patch.
18. Commit the **`governance/card-schema.md`** `role`-enum extension from the agent-proposed patch.
19. Confirm the **Inspector AND `reconcile.py` run on the desktop tier** (real distinct git
    identity) — do not honor git-author-based grading/approval in the cloud tier until per-agent
    identities land. **Confirm the weekly `grades-reconcile` cadence (3.10) is declared on `main`
    and actually runs `reconcile.py`** (emits FROZEN + wake-me on unmatched rows).
20. Commit the **Gemini free-tier-API-key** spec/governance correction (§2/§12), including that
    billing-off is a **human-maintained invariant, not a runtime guard**.

**Phase 4 — Non-Claude worker onboarding**
21. On the desktop: `codex login --device-auth` (ChatGPT sub); create a **free-tier** Gemini API
    key at aistudio.google.com (**no billing**); install it into the Gemini host env. Do NOT
    re-enable the retired Google login; do NOT switch Gemini to a paid/billed key.
22. Create the **Phase A** worker git access: **SSH read/write deploy key** on `kb` (NOT a
    `Contents: write` PAT) + a **GitHub push ruleset blocking direct pushes to `ops`/`main`**
    (the key scope alone does not restrict branches); store key via SSH agent / credential manager;
    add a deny-rule on the credential-store path and audit it.
23. **Only after step 12 merged to `main`:** grant the **Phase B** scoped **ops-push** deploy-key
    path; register `codex-worker`/`gemini-worker` in the governance identity list; keep their
    generated task types `queues-for-me` until grades promote (grade-driven autonomy remains
    advisory-integrity until per-agent GitHub identities + the `ledgers/grades/**` ruleset land).
24. Register Task Scheduler tasks `kb-codex-runner` + `kb-gemini-runner` (Disabled until Phase A
    go-live).
25. Turn **`enforce_admins` on** for protected refs once per-agent scoped identities exist; then
    enable the **push ruleset on `ledgers/grades/**`** restricting writes to the grader identity
    (this is what makes grade-driven promotion tamper-resistant).

**Phase 5 — Optional**
26. Install/auth **Omnara or Happy** for phone session-steering of the desktop tier (kept separate
    from approvals).

---

## 5. Explicitly out of scope for month 1

- **Per-agent GitHub *account* identities (the real attribution fix).** Month-1 "per-agent identity"
  = **git-author config + scoped git-transport access (SSH deploy key) only**. Distinct GitHub
  accounts / App identities — which is what actually makes grade-write **prevention** (`ledgers/
  grades/**` ruleset), `enforce_admins`, independent possession-channel git-write attribution, and
  actor-scoped push rulesets possible — are **month-2+**. A reader should NOT conclude month 1 closes
  the shared-owner-credential attribution hole; it does not.
- **Approvals-via-protected-ref *access control* replacing the signature as the primary gate.** In
  the interim the web-flow **signature + trust-anchor invariant** carry the gate; restrict-merge-to-
  Daniel ships in Wave 1, but `enforce_admins on` is the *end-state* reinforcement, deferred (steps
  9/25).
- **Prevention (not detection) of grade tampering.** The push ruleset on `ledgers/grades/**` is
  deferred behind per-agent GitHub identities; v1 is weekly reconciliation + FROZEN sentinel, which
  is **detection of non-adversarial drift only — not robust against a worker that assumes the
  Inspector identity** (D4 threat model). Interim protection = T3 cap + `queues-for-me` default +
  standing-auth main-ref check + trust-anchor invariant.
- **Cryptographically authenticated STOP/FROZEN kill-switches.** In v1 their integrity depends on the
  trust-anchor invariant + no-worker-write-access; unforgeable placement waits on per-agent
  identities (D4).
- **T3 autonomous execution.** T3 is permanently capped at human-token (possession fast-lane at
  most) in v1; the one-tap fast-lane does nothing consequential until the signed channel + grades
  both exist.
- **Per-workflow Telegram channels / Atlas voice / Chief-of-Staff briefs.** The single bot is
  built voice-capable but month 1 ships text approvals + digests + wake-me only.
- **Low-latency PC-off possession approvals.** PC-off taps are poll-bound (≤24h) — the signed
  GitHub-merge channel is the PC-off path for anything time-critical (D2 latency contract).
- **Gemini on a paid/billed key**, Antigravity CLI, and Vertex AI Express (fallback only).
- **Omnara/Happy as an approval carrier** — session-steering only; never a git-native token path.
- **ntfy** on the critical path (Telegram covers push).
- **Any content-producing / publishing faceless-youtube cadence.** Month 1 ships only the upstream,
  side-effect-free `idea-backlog-refresh`; any YouTube publish stays fully human-gated (O10).
- **Deferred minors stay deferred** (revisit only if they bite): non-ULID ids; preamble edge cases
  (malformed budget.yaml exits 1 not 2, empty-string API key passes, per-step model-id assertion
  prose-only/unenforced); `scan_skill` TEXT_EXT breadth / OS separators / per-line heuristics;
  `new_project` trailing/double hyphens + no partial-scaffold rollback. (Exception: `cards.py`
  role-enum validation is *pulled in* at 4.4 alongside the schema change.)

---

## 6. Open questions that genuinely need Daniel

- **O1 — approvals.py verification review (security-flagged track).** The approvals research was
  flagged for investigating signature/author-forgery. The synthesis uses only its defensive
  conclusion (web-flow signatures are unproducible *by an agent that lacks REST-API access*).
  **Personally read the rewritten `approvals.py`** before it becomes load-bearing, confirm the
  **online REST path is removed** and it fails **closed** when the pinned keyring is missing (must
  never "verify=skip → pass"), **and explicitly answer: can the owner credential in ANY agent
  environment create a web-flow-signed commit via the GitHub REST API? If yes, the signed channel is
  bypassed** — resolve that (enforce the trust-anchor invariant) before the gate is load-bearing.
- **O2 — approval ref choice.** Dedicated protected `approvals` branch (recommended, keeps `main`
  clean) vs reusing `main`. Confirm dispatchers fetch the chosen ref.
- **O3 — Telegram bot-token custody.** Cloud dispatcher env = PC-off-proof but §10 visible-env
  (mitigated: a stolen bot token can't fabricate `from.id=Daniel` or write `ops`); vs desktop OS
  credential manager = tighter but needs PC on, with GitHub PR-merge as the PC-off fallback. Pick
  one, honor the **one-poller-per-bot** invariant AND the **minting-host isolation invariant** (the
  chosen host must not ingest untrusted web content or hold Custom/Full network).
- **O4 — cloud web-fetch for live topic-scouting.** the-second-take's `topic_scouting: live` wants
  cited sources, but Trusted network blocks `WebFetch`. **Constrained by the isolation invariant:**
  if a cadence is granted Custom/Full network for live fetch, it must run on a host that does **not**
  hold the bot token / mint approvals / have ops-write. Accept WebSearch-snippet-only ideation on the
  minting host, or give live fetch to a separate isolated host?
- **O5 — Gemini free-tier billing + data policy.** (a) **Billing-off is human-maintained, not
  runtime-enforced** — confirm a periodic verification cadence (or a pinned-project-id refusal) is
  acceptable, since the runner cannot detect server-side billing enablement. (b) The free key's
  only-$0 path lets Google train on the data (privacy, not billing). Accept it, or defer Gemini until
  a capped billed key is sanctioned? If unacceptable, Gemini has no $0 path.
- **O6 — grades-integrity window.** Accept the weekly detection window (a forged grade could
  promote in the gap before `weekly:sat`), or add a cheap nightly grades-integrity spot-check?
  (Note: reconciliation is spoofable regardless — see D4 threat model; this question is about the
  *time window* of the non-adversarial-drift detector, not adversarial robustness.)
- **O7 — promotion axis.** Confirm promotions key on `(worker, project, task_type, tier)` (so a
  task type proven by Claude does not auto-promote a new Codex/Gemini worker) — the schema assumes
  this.
- **O8 — Codex device-auth durability + headless-subscription behavior.** (a) Sessions expire; a
  periodic human re-login is required — confirm the runner should fail loud (wake-me) on stale
  `~/.codex/auth.json` rather than silently falling back to the metered API. (b) **Verify that
  `codex exec` actually honors ChatGPT-subscription auth non-interactively** (Wave 5.0) — the whole
  Codex leg depends on it.
- **O9 — possession-channel cutline.** Confirm that novel/first-time T3 (merges, deploys, spend)
  routes **only** through the signed GitHub-merge channel, and that Telegram possession-approvals
  are admissible solely for T1/T2 + already-earned fast-lane T3 (the D0 resolution).
- **O10 — "first real faceless cadence" intent.** Confirm that shipping only the upstream,
  side-effect-free `idea-backlog-refresh` (no content output, stops at the idea gate) satisfies
  backlog line 18's "first real faceless-youtube cadence," and that a content-producing/publishing
  cadence is correctly deferred to month 2.

---

## 7. Backlog cross-check (`docs/plans/month-1-backlog.md` → inventory/deferral)

| Backlog line | Maps to |
|---|---|
| I1 (verified-identity / PR / signed commits; reconsider enforce_admins) | 1.2, 1.6 (restrict-merge NOT deferred), 1.7, 1.8, **1.10 (trust-anchor invariant)**; enforce_admins → step 25 (deferred) |
| I3 (fold action+target into hash) | 1.1; migration 1.9 |
| T10 (main→ops merge topology test; frontmatter-field assertion) | 1.5 |
| Approval UX: one-tap (pre-staged PRs / Omnara taps; no 64-char hashes) | D0 two-channel; 1.4 (pre-staged PR) + Wave 2 (Telegram possession tap); hash pre-computed, never typed |
| I4 (routine env→repo binding + cloud-only cycle) | 0.1–0.5, D6 (incl. offline-verify + gpg) |
| Omnara/Happy phone launch/steer | 6.1 (session steering only; orthogonal to approvals) |
| Codex + Gemini + skill adapters in sync; per-agent identities + scoped tokens (prereq: hardening) | Wave 5 (5.0–5.11); ops-push hard-gated behind Wave 1; **worker git = SSH deploy key + push ruleset, NOT Contents:write PAT**; per-agent *GitHub* identity = month-2+ (§5) |
| Grader identity + weekly reconciliation; ledger-driven promotions | Wave 3 (3.1–3.10); **weekly reconcile now actually scheduled (3.10), desktop-pinned (3.2)**; prevention deferred (3.9) with honest threat model (D4) |
| Scout→Manager→Worker→Inspector across ≥3 projects; tiered heartbeats; first faceless cadence | Wave 4 (4.1–4.7) + kb-ops/atlas-prep scaffolds; faceless = mechanism only, no content (O10) |
| Telegram digest bot; per-workflow channels if traffic warrants | Wave 2 (digest = 2.4; interactive-poll cadence 2.6); per-workflow channels → **deferred** (§5) |
| Deferred minor: cards.py role-enum/state-bucket validation | role-enum **pulled in** at 4.4; state-bucket validation → deferred (§5) |
| Deferred minors: non-ULID ids; preamble edge cases; scan_skill; new_project | **deferred** (§5, verbatim) |
| Standing note: desktop fallback healthy | Context (unchanged); desktop runners reuse the pattern (5.3) |
| Standing note: standing authorization 2026-07-15 | Encoded in `promotion.decide()` standing-auth branch **+ main-ref authorship cross-check** (3.1/4.2) + D5 |
| Standing note: humans.yaml dual identities | Extended at 1.8 (GitHub login/email) + 2.9 (telegram_id) |

Every backlog line maps to an inventory item or an explicit §5 deferral.

---

## 8. Revision log — adversarial-panel findings applied

All panel findings were accepted as legitimate (each was verified against the repo where it made a
repo-specific claim; none was factually wrong, so no inline rebuttals were needed).

**Safety-governance lens**
- **#1 (BLOCKER, web-flow forgeable via REST API):** added the **trust-anchor invariant** (no
  agent env holds a REST-API-capable credential; git-transport-only) as a load-bearing precondition
  (top call-out, §3 ordering law (iv), 1.10, step 8); **removed the online REST verification path**
  (D0/D1, 1.2, 2.8, step 15); **restrict-merge-to-Daniel un-deferred** to Wave 1 (D1, 1.6, step 9).
- **#2 (BLOCKER, grade reconciliation spoofable → self-promotion):** rewrote D4 threat model —
  reconciliation is detection of non-adversarial drift only; autonomous grade-driven promotion for
  non-Claude workers gated behind identity hardening; 3.9 reframed as the real-prevention
  prerequisite; interim guards (T3 cap, queues-for-me default) stated.
- **#3 (BLOCKER, standing-auth self-grant):** `decide()` now honors the standing-auth branch only
  when the cadence block is present on the human-only `main` ref (D4 cross-check, 3.1, 4.2, 3.6
  test).
- **#4 (MAJOR, PAT can't restrict by branch):** Phase-A worker git access changed to SSH deploy key
  + a GitHub **push ruleset** blocking `ops`/`main`; explicit note that scope alone doesn't restrict
  branches (D3, 5.8, step 22).
- **#5 (MAJOR, carve-out includes grades/activity ledgers):** carve-out scope now **excludes
  `ledgers/grades/**` and `ledgers/activity/**`**, enumerated non-integrity ledgers only (D4, 0.4,
  3.6 test).
- **#6 (MAJOR, STOP/FROZEN unauthenticated):** documented integrity dependency on trust-anchor +
  identity hardening; FROZEN placed on protected ref where feasible with re-assert-on-clear; no
  worker write access (D4, 3.2, §5).
- **#7 (MAJOR, minting host co-located with untrusted-web ingest):** added the **minting-host
  isolation invariant** (D0, D2, 2.1, step 14, O4).
- **#8 (MINOR, O1 too narrow):** O1 now explicitly asks the REST-web-flow question.
- **#9 (MINOR, Gemini billing not mechanical):** reframed as human-maintained invariant everywhere
  (D3, 5.3, 5.11, O5).
- **#10 (MINOR, tier double-emit/drop):** canonical fail-closed tier assignment + no-double-claim
  test (D5, 3.6).

**Feasibility lens**
- **#1 (MAJOR, cloud verifier runtime unestablished):** gpg added to cloud setup; offline-verify
  end-to-end proof added as Wave-0 item 0.5 / step 7; desktop-only fallback recorded (D6).
- **#2 (MAJOR, "no production code consumes approved_by_human" false):** corrected — nightly.md 4b
  does; added migration item 1.9 + rationale fix (D1).
- **#3 (MAJOR, Gemini guard):** same as safety #9.
- **#4 (MAJOR, possession poll cadence/latency):** explicit poll cadence (2.6) + honest latency
  contract (D2); PC-off not low-latency, signed channel is the PC-off path.
- **#5 (MINOR, reconciliation spoofable):** covered by safety #2 (threat model in D4).
- **#6 (MINOR, unverified tool-version claims):** verify-tool-behavior gates at Wave 0 (0.1) and
  Wave 5 (5.0); codex-exec-headless-subscription flagged as the key assumption (D3, O8).

**Completeness lens**
- **#1 (BLOCKER, reconcile never scheduled):** added weekly `grades-reconcile` cadence (3.10) +
  checklist step 19.
- **#2 (MAJOR, reconcile not desktop-pinned):** pinned to desktop (D4, 3.2, 3.10).
- **#3 (MAJOR, carve-out ordering inversion):** Wave 0 reordered — carve-out committed+merged (0.4/
  step 6) before Run-now verification (0.5/step 7).
- **#4 (MINOR, "first real faceless cadence"):** scope note + O10.
- **#5 (MINOR, grade schema/rubric implicit):** made explicit deliverables (D4, 3.3, 3.5).
- **#6 (MINOR, per-agent identity overclaim):** §5 states month-1 identity = git-author + scoped
  token only; GitHub-account separation is month-2+.
- **#7 (MINOR, poller latency):** covered by feasibility #4.
- **#8 (MINOR, Wave 2 dep undeclared):** Wave 2 header now declares dependency on 1.1–1.2.
- **#9 (MINOR, per-role identity overclaim):** D5 scopes the load-bearing identity claim to the
  Inspector.

**Unresolved / flagged for Daniel (could not be fully closed in a doc edit):**
- The **residual Phase-A shared-identity limitation** (#4): because all agents still authenticate as
  the one owner account, an *actor-scoped* push ruleset cannot distinguish a worker from Daniel; the
  interim mitigation (block direct `ops`/`main` pushes via require-PR for the owner path too, plus
  SSH-deploy-key transport) is documented but full actor separation genuinely requires per-agent
  GitHub identities (month-2+). Flagged, not eliminated.
- **STOP/FROZEN cryptographic integrity** (#6) cannot be fully achieved in v1 for the same reason —
  documented as an interim risk with protected-ref placement + re-assert-on-clear as the best
  available mitigation, prevention deferred to per-agent identities.
- Several **tool-behavior facts** (codex-exec headless subscription, claude.ai branch-push toggle,
  Gemini/Antigravity limits) are post-cutoff and **must be verified by Daniel** against live docs
  (Wave 0.1 / 5.0) — a doc edit cannot confirm them.
