# External reach — design (2026-07-20, arc-3 part 4)

**Status:** design only. Nothing here is wired. Extends
`docs/specs/2026-07-19-executor-activation-and-integrations-design.md` (arc-1 D9–D16); it does not
replace it. Where arc-1 already decided something, this doc cites the decision and moves on.

**Mandate (Daniel, 2026-07-20):** "run all of the work that I would normally be able to with claude
desktop like access gmail, google drive, calendar, plan/take meetings notes, and such, directly from
here via an agent running. Thus, agents/workflows should not be constrained to performing tasks on
just the knowledge base/projects within kb."

---

## 0. What already exists (read this before designing anything new)

Arc-1 built more of this than the mandate assumes. Verified on `claude/fleet-arc` @ `d67f416`:

| Thing | Where | State |
|---|---|---|
| Workflow tool-allowlist profiles | `dashboard/server/control/environment.ts:36-91` | **Exists.** Four profiles: `research`, `gmail-triage`, `drive-author`, `producer` |
| `gmail-triage` allowlist (search/read/labels/**draft**) | `environment.ts:55-65` | **Exists**, names `mcp__google-workspace__*` |
| `drive-author` allowlist (search/read/create/upload) | `environment.ts:66-76` | **Exists** |
| Send/publish tool denylist | `environment.ts:41-47` (`FORBIDDEN_WORKFLOW_TOOLS`) | **Exists**, test-enforced at `dashboard/server/workflows/profiles.test.ts:12-20` |
| Email-triage workflow definition | `orgs/kb-ops/workflows/email-triage.md` | **Exists, complete.** 4-tier taxonomy, draft-only, report + follow-through checklist |
| Research workflow definition | `orgs/kb-ops/workflows/research-brief.md` | **Exists** |
| Action-namespace risk registry | `dashboard/server/control/policy.ts:84-121` | **Exists**, closed table + forbidden namespaces |
| Credential / spend / publication refusals | `policy.ts:139-142` | **Exists** |
| YouTube analytics integration | `scripts/yt_analytics.py` | **Exists**, fail-closed `not-authed` exit code 3 |
| OAuth gate cards G1–G4 | `queue/inbox/6a5d6b23-{12ddfee2,05204b15,4c98aec0,17e8d1be}.md` on `ops` | **Exist**, T3, `owner: human-operator` |

**Plainly: item 5 of the brief (the email-triage workflow) is already written.** It does not need
sketching. It needs the plumbing under it to work. This doc therefore spends its weight on the
plumbing, and §6 records the one delta the existing definition needs.

### 0.1 The severed wire — the central finding

The `gmail-triage` profile's `allowedTools` **never reaches a spawned worker.** The chain is cut in
two places:

1. **`PlanProposal` has no `profile` field.** `dashboard/server/control/proposal.ts:99-109` defines
   the proposal shape: `{schema, proposalId, project, title, summary, manager, scope,
   governanceRefs, stages}`. No profile. The workflow's `profile:` frontmatter is consumed by
   `compile.ts:41` **only as an input to the proposal-id hash preimage** (`deriveProposalId`). It
   influences proposal *identity* and is then dropped as data. Nothing downstream can read it.
2. **`resolveToolPolicy` has no production caller.** `claudeWorkerAdapter.ts:106` declares
   `resolveToolPolicy(profile: ExecutionProfile): ClaudeToolPolicy` and `:365` calls it to build
   `--allowedTools` (`:207-208`). Every construction of `createClaudeWorkerAdapter` in the repo is
   in `claudeWorkerAdapter.test.ts`. `loadWorkflowProfiles()` (`environment.ts:84`) is likewise
   called only by `profiles.test.ts`. The only production consumer of the profiles module is
   `workflows/routes.ts:76`, which uses `workflowProfileIds()` for **name validation only**.

There is also a **name collision** that will bite whoever wires this: `ExecutionProfile`
(`policy.ts:5-11`, `{id, role, runtime, model, capabilities}`) and `WorkflowExecutionProfile`
(`environment.ts:35-39`, `{id, allowedTools}`) are unrelated types both called "profile".
`resolveToolPolicy` takes the *former* and must somehow produce the *latter*'s allowlist. That
signature is wrong for the job — see interface request **IR-1**.

**Consequence:** external reach is not blocked only on Daniel's OAuth gates. Even with G1–G4 closed
and the executor activated, a `gmail-triage` run would spawn a worker with **no `--allowedTools`
flag at all** (`claudeWorkerAdapter.ts:207` skips the flag when the array is empty), i.e. falling
back to `--permission-mode` defaults rather than the intended cap. The cap is currently decorative.
Fixing this is increment 1 (§7) and it is pure control-plane work needing no OAuth.

---

## 1. The capability model

### 1.1 Vocabulary — no new mechanism

External reach reuses exactly three existing server-owned concepts. No parallel system:

1. **Action namespace → risk floor.** `classifyActionRisk` (`policy.ts:112-121`) maps the segment
   before the first `:` in a stage's `action` to a minimum tier. The table is closed
   (`policy.ts:88-107`); an unregistered namespace fails the whole definition
   (`defs.ts` header, `policy.ts:119`). Prose can never lower a floor — `defs.ts:47` computes
   `max(declared, classified floor)`.
2. **Workflow profile → tool allowlist.** `WorkflowExecutionProfile.allowedTools`
   (`environment.ts:36-39`) becomes `--allowedTools` (`claudeWorkerAdapter.ts:207-208`). A
   definition may only *name* a profile (`defs.ts:227`), never widen one.
3. **Policy disposition.** `evaluateExecutionPolicy` (`policy.ts:128-166`) returns
   `allow | waiting-human | refuse`.

A Gmail/Drive/Calendar/YouTube tool becomes available to a stage **iff** the stage's workflow names
a profile whose `allowedTools` contains that tool id, AND the stage's action namespace classifies at
or below the tier the run is approved for. Two independent gates: the profile caps *what tools
exist*, the tier caps *what approval is required*. Neither can be widened from a definition file or
the browser.

### 1.2 Operation classes and tiers

Tiers per `governance/risk-tiers.md`. The principle: **tier tracks irreversibility and outward
visibility, not sensitivity of the data read.**

| Class | Example tools | Proposed action namespace | Tier | Reasoning |
|---|---|---|---|---|
| Workspace **read** | `search_gmail_messages`, `get_gmail_message_content`, `search_drive_files`, `get_drive_file_content`, `list_calendar_events` | `research:` | **T2** | Reversible, no outward trace. Uses the existing `research` floor (`policy.ts:97`). Not T1: it reads the operator's private correspondence, so it should not ride the T1 unattended lane. |
| Workspace **annotate** | `modify_gmail_message_labels` | `research:` | **T2** | Visible only in Daniel's own mailbox, trivially reversible. |
| **Draft** creation | `draft_gmail_message` | `draft:` | **T2** | `draft` is already registered at T2 (`policy.ts:90`). Nothing leaves the account; a draft is an artifact for human review. This is the ceiling for autonomous mail work. |
| Drive **create/modify** | `create_drive_file`, `upload_to_drive` | `draft:` or `build:` | **T2** | A private Drive file is reversible and invisible to third parties — genuinely T2. **But see §4.2:** sharing/permission changes are not, and must not be reachable at T2. |
| Calendar **write** | create/update/delete event | `publish:` | **T3** | An invite emails other humans. Outward-facing and socially irreversible. Deliberately *not* T2 despite feeling like a small action. |
| **Send** mail | any send tool | — | **T3**, and denied by profile | Outward, irreversible. §4.1. |
| YouTube **publish** | `upload_video` | `publish:` (`policy.ts:102`) | **T3** | Already T3; already in `FORBIDDEN_WORKFLOW_TOOLS` (`environment.ts:43`). |
| YouTube **analytics** | `scripts/yt_analytics.py` | `research:` | **T2** | Read-only; runs as a script under `producer`/`Bash`, not an MCP tool. |
| Credential handling | any | `credential:`/`secret:` | **T4 — forbidden** | `policy.ts:109-110` refuses the namespace; `policy.ts:139` refuses `requestsCredentials`. Not designed around; designed *behind*. |

### 1.3 New profiles required

Two of the mandate's four surfaces have no profile today:

- **`calendar-read`** — `mcp__google-workspace__list_calendar_events`,
  `mcp__google-workspace__get_calendar_event`, plus `Read`/`Write`. T2 read-only. Needed for
  "plan/take meeting notes"; G2 already enables the calendar tool group
  (`uvx workspace-mcp --tools gmail drive calendar`, gate card G2 step 2).
- **`meeting-notes`** — union of `calendar-read` + `drive-author` + `Read`/`Write`. Reads the day's
  events, drafts notes, writes them to Drive and/or `orgs/<project>/output/`. This is the
  highest-value composite for the mandate and is still entirely T2.

**No `calendar-write` profile is proposed in v1.** Calendar writes are T3 (§1.2) and T3 stalls at
approval anyway (`policy.ts:145`); shipping the profile before the approval UX exists just creates a
tool that always stalls. Deferred to increment 4.

Both are one-line additions to `WORKFLOW_EXECUTION_PROFILES` (`environment.ts:48-81`) — a
code-reviewed capability change, exactly as the module header intends. **That file is outside this
agent's ownership boundary** → interface request **IR-2**.

### 1.4 The scope-containment problem

`defs.ts` requires every stage `target` to live under `orgs/<project>/` (`defs.ts:32`, "Every
workflow target must live under `orgs/<project>/`"), and `policy.ts:162` refuses a target outside
the approved write scope. This is correct for repo writes and says nothing about external effects —
a Gmail draft has no repo path.

This is load-bearing and should stay: **the repo target is where the run's *evidence* lands, not
where its effect lands.** `email-triage.md` already models this correctly — target
`orgs/kb-ops/output`, effects in Gmail, and the report is the auditable artifact. Every external
workflow must follow that shape: *the external effect is always accompanied by a repo-side report
under the stage target.* That is the only reason an external run is auditable at all, since the
control plane cannot see into Gmail.

---

## 2. Auth

### 2.1 The constitutional constraint

CLAUDE.md: "never handle credentials as objects (create/read stores/modify); ambient runtime
credentials may be used but never printed, copied, persisted, or transmitted."

The arc-1 architecture already satisfies this, and the satisfying property is **that the dashboard
never sees a token at all**:

- Daniel completes OAuth *interactively, himself* (gate cards G1–G4). The refresh token is written
  by the MCP server / the script to a location the dashboard does not read:
  `%USERPROFILE%\.google_workspace_mcp\credentials\` (G2 step 2),
  `C:\Users\danie\youtube-uploader-mcp\config\.youtube_uploader_channels_cache` (G3 step 2),
  `%USERPROFILE%\.yt-analytics-token.json` (G4 step 1, `yt_analytics.py` header).
- A spawned worker inherits the ability to *use* those tokens because the MCP server process reads
  its own credential store. The worker never holds the token; it calls a tool.
- The dashboard's contribution is **negative**: it decides which tool names are allowed. It has no
  credential code path to audit.

This is the strongest available posture and it should be stated as an invariant:

> **AUTH INVARIANT.** No dashboard module reads, writes, parses, forwards, or logs an OAuth token,
> client secret, or authorization code. Connectors declare *tool names*; the credential lives with
> the MCP server or the script that minted it. A connector that needs to read a token file is
> misdesigned.

Enforcement notes for the build:
- `claudeWorkerAdapter` must strip credential-named env vars before spawn — arc-1 §2 already
  specifies this ("NO `ANTHROPIC_API_KEY` in env (preamble invariant); strips credential-named vars
  like the PTY host does"). Confirm at build time; it is not yet implemented (the adapter is
  unwired).
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (G2 step 1) are set by Daniel at **user
  scope via `setx`**. They are consumed by `uvx workspace-mcp` at *its* launch, not by the
  dashboard. The dashboard must not read them and must not pass them through. If the MCP server is
  registered `--scope user` (G2 step 3), Claude Code launches it and the dashboard is not in the
  loop at all — which is the desired topology.
- Audit rows record tool *names invoked*, never arguments, for Gmail/Drive tools. A logged
  `get_gmail_message_content` argument is a message id; a logged *result* would be correspondence.
  Existing NDJSON audit trail must be checked for result-capture before Gmail is live.

### 2.2 Gate → connector dependency map

Which human gates must close before each connector can do anything:

| Connector / profile | Blocking gates | Also blocked on |
|---|---|---|
| `research` (WebSearch/WebFetch) | **none** | executor activation only |
| `gmail-triage` | **G1** (`6a5d6b23-12ddfee2`) + **G2** (`6a5d6b23-05204b15`) | IR-1 (allowlist wire), executor activation |
| `drive-author` | **G1** + **G2** | IR-1, executor activation |
| `calendar-read` (new) | **G1** + **G2** | IR-1, IR-2 (profile does not exist), executor activation |
| `meeting-notes` (new) | **G1** + **G2** | IR-1, IR-2, executor activation |
| YouTube analytics (`yt_analytics.py` under `producer`) | **G1** + **G4** (`6a5d6b23-17e8d1be`) | executor activation |
| YouTube publish | **G1** + **G3** (`6a5d6b23-4c98aec0`) | **plus a T3 approval per publish** — and no profile grants the tool (§4.3) |

**G1 is the root of everything Google.** It creates the OAuth client and enables the five APIs; G2/
G3/G4 all consume its output. G1 step 4 (**publish the consent screen**) is not optional polish: in
Testing mode Google expires refresh tokens after 7 days for sensitive scopes, so headless workers
would die silently every week. A connector built against an unpublished consent screen will appear
to work for a week and then fail in a way that looks like a code bug.

**Additional unrecorded prerequisite (not in any gate card):** there is **no `.mcp.json` in the
repo** and no evidence the `google-workspace` server is registered anywhere — verified by absence
of the file and by grep: every `mcp__google-workspace__*` hit in the repo is in `environment.ts`,
`profiles.test.ts`, or design docs; none is a registration. G2 step 3
(`claude mcp add --scope user google-workspace -- uvx workspace-mcp --tools gmail drive calendar`)
is the registration step and it has not been run. This is correctly *inside* G2, so no new card is
needed — but nobody should expect the tools to resolve before G2 completes.

### 2.3 Fail-closed behaviour before the gates

`yt_analytics.py` sets the standard worth copying (its header, and NOT_AUTHED exit code 3): when the
credential is absent, exit **cleanly** with a message naming exactly what is missing and which gate
card mints it — never confuse "not set up yet" with "ran and found nothing."

For MCP-backed connectors the failure mode is different and worse: if the server is unregistered,
the tool name simply does not resolve and the worker will improvise around it (search the web
instead of Gmail, write a local file instead of Drive) and report success. **Silent capability
substitution is the specific danger of the MCP path.** Mitigation → §5, preflight.

---

## 3. The MCP question — recommendation

### 3.1 The decisive fact

The `mcp__claude_ai_Gmail__*` and `mcp__claude_ai_Google_Drive__*` tools available in *this
interactive session* are **claude.ai connectors**, and per arc-1 D9 research
(`2026-07-19-executor-activation-and-integrations-design.md:29,111`) they **do not load in headless
`claude -p`** — anthropics/claude-code#72914: connected but tools never registered in the CLI.

The dashboard executes work by spawning `claude -p` (`claudeWorkerAdapter.ts:8`, arc-1 §2). So the
option the brief calls (a) — "proxy these MCP servers" — is, for the claude.ai connectors
specifically, **not available**. There is nothing to proxy: they are not exposed as a server the
dashboard could connect to, they are a hosted binding to the claude.ai client session.

Two things follow, and I want to be precise because the brief's framing conflates them:

- Proxying **claude.ai connectors**: not possible. Not a preference, a fact.
- Using a **local stdio MCP server** (`uvx workspace-mcp`): entirely possible, and this is what
  arc-1 already chose (D9) and what `environment.ts:55-76` already encodes in tool names.

### 3.2 Recommendation

**Recommend (a), read as: a single local stdio MCP server (`taylorwilsdon/google_workspace_mcp`),
consumed via `--allowedTools`. Do not write our own Gmail/Drive/Calendar connectors.**

Reasons, in order of weight:

1. **The auth invariant falls out for free.** A local MCP server owns its own credential store
   (`~/.google_workspace_mcp/credentials/`). Hand-written connectors would mean *our* code holding a
   refresh token, refreshing it, and persisting it — the dashboard would acquire a credential code
   path it currently does not have, in direct tension with "never handle credentials as objects."
   This alone is close to decisive.
2. **The control surface already speaks tool names.** `allowedTools` (`environment.ts:38`) →
   `--allowedTools` (`claudeWorkerAdapter.ts:208`) is a string allowlist. MCP tools are string
   names. A hand-written connector is *not* a tool name — it is an HTTP route or a script, and
   capping it would require inventing a second capability mechanism, which the brief explicitly
   forbids and which would be the real architectural mistake here.
3. **Zero new code for three surfaces.** Gmail + Drive + Calendar from one `uvx` invocation. The
   profiles are already written against those exact names.
4. **Precedent already accepted.** `youtube-uploader-mcp` is an external stdio MCP server already
   registered globally (G3 card: "the server is already registered globally"). The pattern is in
   use.

**Where I do not follow (a): YouTube analytics.** `scripts/yt_analytics.py` already exists, is
stdlib-only, and covers a surface with no maintained MCP server (arc-1 D11). Keep it. So the honest
answer to "(a), (b), or (c)" is: **(a) for Gmail/Drive/Calendar, with one pre-existing script
exception for YouTube Analytics.** That is a recommendation, not a hedge — the split follows a rule:
*MCP where a maintained server exists; a script only where none does.*

### 3.3 Costs of this choice, stated honestly

- **Supply chain.** `uvx workspace-mcp` executes third-party code with access to Daniel's mail and
  Drive. G2's card already warns: "verify the package is taylorwilsdon/google_workspace_mcp (an
  abandoned same-name PyPI package exists)." **This is the single largest residual risk in the whole
  design** (§8). A hand-written connector would not have it — that is the one genuine argument for
  (b), and it loses to the credential-handling argument, but it should be recorded as lost rather
  than ignored.
- **Version drift.** If upstream renames a tool, `environment.ts`'s allowlist silently stops
  matching and capability vanishes (or, worse per §2.3, gets substituted). Mitigated by preflight
  (§5).
- **Coupling to `--scope user` registration.** The dashboard depends on a machine-level Claude Code
  config it does not own or verify. Preflight again.

### 3.4 What about the connectors directory?

`dashboard/server/connectors/**` should exist, but **not as HTTP clients**. It should hold the
*declarative* layer: which external capability exists, which tool names implement it, which gate
card unblocks it, and a preflight probe. No network code, no credentials. See §5.

---

## 4. Write-action safety

Reuse `policy.ts` dispositions and the existing Human Inbox. No new approval machinery.

The existing spine: `policy.ts:142` returns `waiting-human` for `requestsPublication`;
`policy.ts:145` returns `waiting-human` for any `riskTier === 'T3'`;
`approvals/humanInbox.ts` projects approval boundaries to the operator with `buttons` from
`assurance.ts`; `governance/risk-tiers.md` §"Approval channels (D2.13)" requires **T3 → dashboard/
WebAuthn-signed channel ONLY** (the weak/Telegram channel must not authorize T3).

### 4.1 Sending email — *not a capability in v1*

Recommend **no send path at all**, rather than a gated one. Rationale: `email-triage.md` already
produces drafts and a follow-through checklist ("Review every draft under Drafts and send or edit
the ones you agree with"). Gmail's own UI is a better approval surface for an email than anything
the dashboard would build — Daniel sees the real rendered message, edits in place, and sends. A
dashboard "approve send" button would show him a serialization of the message and then send a
different-looking thing.

Enforcement is already three-deep and should stay: `FORBIDDEN_WORKFLOW_TOOLS`
(`environment.ts:42-47`) lists three send-tool spellings; `profiles.test.ts:12-20` asserts no
profile contains them **and** regex-rejects anything matching
`/upload_video|send_email|gmail_send|send_message/i`; the `environment.ts:32-34` header states the
invariant in prose. Revisiting send is a governance decision for Daniel, not a design choice — and
per CLAUDE.md, `governance/` is human-edited, so it would ship as a DRAFT card.

### 4.2 Creating a Drive file

**Private file creation: T2, no per-action approval.** Reversible, invisible to others, and the run
report names every file created. Gating it would make the mandate's core use case ("create documents
/ folders in Drive") unusably slow for no safety gain.

**Sharing/permission change: T3, and no profile grants it.** The irreversible act in Drive is not
creation, it is exposure. `drive-author` (`environment.ts:66-76`) grants `search`, `get_content`,
`create_drive_file`, `upload_to_drive` — **no permission tool. This is correct and must be held.**

→ Interface request **IR-3**: add Drive permission/share tool spellings to
`FORBIDDEN_WORKFLOW_TOOLS` and to the `profiles.test.ts` regex, so a future profile edit cannot
introduce sharing by accident. Today the regex would not catch `share_drive_file`.

### 4.3 Publishing to YouTube

Already fully specified by the existing machinery; **change nothing**:
`publish` classifies T3 (`policy.ts:102`); T3 stalls at `waiting-human` (`policy.ts:145`); T3 needs
a WebAuthn-signed approval (`risk-tiers.md` D2.13); `upload_video` is in `FORBIDDEN_WORKFLOW_TOOLS`
(`environment.ts:43`) so **no workflow profile can ever hold it**. Publishing therefore cannot
happen inside a workflow run at all — it requires a human acting through a separately-granted
session. The `video-run.md` definition on `claude/faceless-live-import` (`33826cd`) honours this:
its commit message records "publish deliberately not a stage."

That is the right shape: for the highest-consequence action, the answer is not "approve it in the
UI", it is "a workflow cannot do this."

### 4.4 Calendar writes

T3 per §1.2 → stalls at `waiting-human` → WebAuthn approval. Because no `calendar-write` profile is
proposed in v1, this is theory until increment 4.

### 4.5 Summary

| Action | Tier | Mechanism | Human step |
|---|---|---|---|
| Read mail/Drive/calendar | T2 | profile allowlist | none per-action |
| Apply Gmail label | T2 | profile allowlist | none per-action |
| Create Gmail draft | T2 | profile allowlist | reviews + sends in Gmail |
| **Send** mail | — | **no tool in any profile** | send by hand |
| Create private Drive file | T2 | profile allowlist | reviews via run report |
| **Share** a Drive file | T3 | **no tool in any profile** (IR-3) | do it by hand |
| Create calendar event | T3 | `waiting-human` + WebAuthn | approve (v2) |
| **Publish** to YouTube | T3 | **no tool in any profile** | outside workflows entirely |

---

## 5. `dashboard/server/connectors/**` — the declarative layer

Purpose: make external capability **legible and preflightable**, without touching credentials or the
network. One module, pure data plus one probe.

```
dashboard/server/connectors/
  catalog.ts        # ExternalConnector[] — pure frozen data, no I/O
  catalog.test.ts   # cross-checks the catalog against environment.ts + policy.ts
  preflight.ts      # is this connector's server actually registered? (increment 3)
```

```ts
export interface ExternalConnector {
  id: 'google-workspace' | 'youtube-uploader' | 'youtube-analytics';
  transport: 'mcp-stdio' | 'script';
  /** Tool-name prefix (mcp-stdio) or repo-relative script path. */
  handle: string;
  /** Capability groups this connector can serve, keyed to workflow profile ids. */
  serves: readonly string[];
  /** Gate card ids that must reach `done` before this connector can function. */
  requiredGates: readonly string[];
  /** Human-readable note naming what is missing when preflight fails. */
  notAuthedHint: string;
}
```

Two invariants the co-located test enforces — this is the module's real value:

1. **No orphan tools.** Every `mcp__*` tool named in any `WORKFLOW_EXECUTION_PROFILES` entry
   (`environment.ts:48-81`) must be covered by some connector's `handle` prefix. Catches a profile
   referencing a server nobody registered.
2. **No forbidden tool granted through a served profile.** For every connector, every profile it
   serves must exclude that connector's `FORBIDDEN_WORKFLOW_TOOLS` (`environment.ts:42-47`) entries.

   **A correction worth recording**, found by writing this test and watching it fail: the first
   formulation asserted that *no connector handle covers a forbidden tool*. That is unsatisfiable and
   conceptually wrong — a handle is a **whole-server prefix**, so `mcp__google-workspace__` covers
   `mcp__google-workspace__send_email` by construction. The Google Workspace server **can** send mail;
   we simply never grant the tool.

   So: **the connector layer cannot enforce the send/publish ban, and must not be described as if it
   could.** Only the profile allowlist enforces it (`profiles.test.ts:12-20`). The catalog's honest
   contribution is the *conjunction* — where a connector is reachable at all, the profiles it serves
   are checked against that connector's specific forbidden tools. Anything stronger would be false
   comfort in a security-relevant place.

`preflight.ts` (increment 3) answers "would a `gmail-triage` run actually have its tools?" by
shelling `claude mcp list` and matching server names — **never by calling a Google API, never by
reading a credential file**. Result feeds a run-start check that fails the run with a named gate
card rather than letting the worker improvise (§2.3). This is the specific defence against silent
capability substitution.

---

## 6. The email-triage workflow

**It exists at `orgs/kb-ops/workflows/email-triage.md` and is well-formed.** Verified against the
parser: closed frontmatter keys `{id, project, title, profile, stages}` (`defs.ts:211`), profile
`gmail-triage` is a known id (`defs.ts:227` ⇄ `environment.ts:54`), action `research:email-triage`
classifies T2 (`policy.ts:97`), declared `riskTier: T2` matches the floor so
`max(declared, floor) = T2` (`defs.ts:47`), target `orgs/kb-ops/output` is under `orgs/<project>/`
(`defs.ts:32`). Body carries the 4-tier taxonomy, the draft-only rule, the report path, and the
follow-through checklist. It even states the auth posture correctly: "Handle no credentials as
objects; the Gmail connection is ambient and read/label/draft-scoped."

The format matches `video-run.md` (`33826cd` on `claude/faceless-live-import`) — same closed
frontmatter, one stage per pipeline step, `producer` profile, all T2, publish absent.

**One delta needed** (an interface request, since the file is arguably shared territory —
**IR-4**): the checklist says "Add any meeting_info times to the calendar (this workflow does not
touch the calendar)." Once `calendar-read` exists (increment 4), a second workflow
`orgs/kb-ops/workflows/meeting-notes.md` should own that, and this line should point at it rather
than at the operator. Sketch:

```yaml
---
id: meeting-notes
project: kb-ops
title: Meeting notes (read-only calendar + Drive draft)
profile: meeting-notes
stages:
  - id: agenda
    title: Read today's calendar and assemble an agenda
    action: research:meeting-agenda
    target: orgs/kb-ops/output
    riskTier: T2
  - id: notes
    title: Draft the notes document
    action: draft:meeting-notes
    target: orgs/kb-ops/output
    dependsOn: [agenda]
    riskTier: T2
---
```

Both actions sit on registered namespaces (`research` T2 `policy.ts:97`, `draft` T2 `policy.ts:90`),
so the definition compiles without touching the action registry. Calendar **writes** are absent by
construction.

---

## 7. Staged build plan

### Increment 1 — reconnect the allowlist (smallest genuinely useful increment)

**Do this first. It needs no OAuth, no new connector, no UI, and no gate.** It converts a decorative
cap into a real one, and it is a prerequisite for every later increment.

- Carry the workflow profile from definition to execution: `PlanProposal` (`proposal.ts:99-109`)
  gains an optional server-validated `profile` field; `compile.ts:41` stops treating it as
  hash-preimage-only; `execution.ts` passes it to the worker adapter.
- Give `resolveToolPolicy` a production implementation backed by `loadWorkflowProfiles()`
  (`environment.ts:84`), and fix its parameter type (**IR-1**).
- Test: a `gmail-triage` stage produces `--allowedTools` containing
  `mcp__google-workspace__draft_gmail_message` and **not** any `FORBIDDEN_WORKFLOW_TOOLS` entry;
  an unknown profile fails closed with **no** tools rather than defaulting open.

Value even with zero external reach: `research` and `producer` runs become genuinely capped.

### Increment 2 — the connectors catalog

`catalog.ts` + `catalog.test.ts` per §5. Pure data. Makes the gate dependencies machine-checkable
and the orphan-tool class of bug impossible. Still no OAuth.

### Increment 3 — preflight + gate surfacing

`preflight.ts`; run-start check fails a run with a named gate card instead of improvising. Requires
**IR-5** (client UI) to display it well, but degrades to a plain failure reason without it.

### Increment 4 — new profiles and the meeting-notes workflow

`calendar-read` + `meeting-notes` profiles (**IR-2**), `orgs/kb-ops/workflows/meeting-notes.md`,
IR-4 checklist fix. **First increment that actually needs G1+G2 closed to demonstrate.**

### Increment 5 — first live external run

Executor activation + G1 + G2, then run `email-triage.md` end to end under supervision. Verify: no
send occurred, labels correct, drafts present and unsent, report written, audit rows carry tool
names but no message content (§2.1).

### Increment 6 — deferred

Calendar writes (T3 + WebAuthn), YouTube analytics surfacing (G4), any revisit of send (governance
DRAFT card, Daniel's call).

Ordering rationale: 1–3 are pure control-plane work that can land while the gates stay blocked, and
each makes the eventual live run safer. Nothing before increment 5 can touch Daniel's data.

---

## 8. Risks

1. **Supply chain — `uvx workspace-mcp` (highest).** Third-party code with mail + Drive access,
   installed by name, with a known same-name squat (G2 card). Everything else in this design is
   defence-in-depth around a component we do not control. Mitigation is thin: verify the repo at
   install, pin a version. Recorded, not solved.
2. **The severed wire creating false confidence (§0.1).** The profiles read as if reach is already
   capped; `profiles.test.ts` passes; nothing enforces it at runtime. Anyone activating the executor
   before increment 1 gets uncapped workers while believing otherwise. **This is the most likely
   way this system actually causes harm**, and it is invisible from the outside.
3. **Silent capability substitution (§2.3).** Unresolved tool name → worker improvises → run reports
   success having done something else. Preflight (increment 3) is the only real answer.
4. **Audit capturing correspondence.** If the NDJSON trail records tool *results*, the audit log
   becomes a copy of Daniel's inbox with weaker handling than Gmail's. Must be checked before
   increment 5.
5. **7-day token death if G1 step 4 is skipped.** Fails a week later, looks like a code bug.
6. **Tier drift under pressure.** The tier table (§1.2) is defensible but the pressure will be to
   "just let it send" once drafts feel tedious. The design's answer is structural — *the tool is not
   in any profile* — which is much harder to erode than a policy check.

---

## 9. Interface requests (work outside this agent's ownership boundary)

| # | Territory | Request |
|---|---|---|
| **IR-1** | `dashboard/server/control/{proposal,compile,execution,claudeWorkerAdapter}.ts` | Carry workflow `profile` into `PlanProposal` and to the worker; implement `resolveToolPolicy` in production; change its parameter from `ExecutionProfile` (`policy.ts:5`) to the workflow profile id — the current signature (`claudeWorkerAdapter.ts:106`) cannot do the job. Increment 1. |
| **IR-2** | `dashboard/server/control/environment.ts` | Add `calendar-read` and `meeting-notes` to `WORKFLOW_EXECUTION_PROFILES` (`:48-81`); update the expected-id set in `workflows/profiles.test.ts:7`. |
| **IR-3** | `dashboard/server/control/environment.ts` + `workflows/profiles.test.ts` | Add Drive permission/share tool spellings to `FORBIDDEN_WORKFLOW_TOOLS` (`:42-47`) and extend the `profiles.test.ts:17` regex to `share|permission`. Closes §4.2. |
| **IR-4** | `orgs/kb-ops/workflows/email-triage.md` | After increment 4, repoint the calendar line in the follow-through checklist at `meeting-notes.md`. |
| **IR-5** | `dashboard/src/**` (client UI agent) | A workflow whose connector is gate-blocked must render as **blocked with the gate card id**, not as a generic failure. Needs: per-workflow connector status (`ready` / `blocked:<cardId>` / `unknown`) on the workflows list, and the same on the run detail surface when a run fails preflight. Server will expose it from `connectors/preflight.ts` (increment 3). |
| **IR-6** | `governance/` (human-edited → DRAFT card only) | If Daniel ever wants send, it is a governance amendment, not a profile edit. No agent should make this change. |

---

## 10. Honest answers to the mandate

- **"Access gmail, drive, calendar"** — designed, and Gmail/Drive profiles already written. Blocked
  on G1+G2 (human) and on increment 1 (not human, not started).
- **"Plan/take meeting notes"** — needs the two new profiles (IR-2) and one workflow. No new
  mechanism; T2 throughout.
- **"Email triage from cowork"** — **already ported**, at `orgs/kb-ops/workflows/email-triage.md`.
  Needs plumbing, not authoring.
- **"YouTube posting and analytics"** — analytics ready (G1+G4). Posting deliberately **cannot**
  happen from a workflow (§4.3) and should stay that way.
- **"Not constrained to just the knowledge base"** — the constraint that remains is
  `defs.ts:32`/`policy.ts:162`: every stage still writes its *evidence* under `orgs/<project>/`.
  External *effects* are unconstrained by it. That constraint should stay — it is what makes an
  external run auditable at all.
