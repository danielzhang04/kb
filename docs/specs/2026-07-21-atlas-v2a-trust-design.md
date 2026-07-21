# Atlas V2a "Trust" — design (voice-stages / passkey-completes approval loop)

**Status:** DESIGN GATE PASSED (Daniel, 2026-07-21, boss session — the same conversation gate V0
and V1 used). Two decisions were settled at the gate and are folded in below (§8 records them);
the earlier open-questions list is closed. **The build wave itself is NOT yet authorized** — per
the go/no-go brief, starting the §11 wave is a separate, explicit go from Daniel.
**Amends:** `2026-07-19-atlas-build-delta-design.md` §5 (V2 row) and §3 (V2 tool row) — this doc
takes only the *approval-loop* portion of that V2 row and designs it in full. Every other decision
in the delta design and the V1 hands design stands.
**Supersedes:** `2026-07-15-atlas-voice-layer-design.md` §9 ("Spoken approvals" / "desk presence =
identity") — that voice-only-commit bar is **refuted** and listed as a non-goal in §4 with its
rationale. The delta design already began this reversal; this doc completes it.
**Written after:** V1 "Hands" merged live (PR #44 = `aa35b00`, prod 5317, 10 cards graded 95–97).
Informed by the 2026-07-21 go/no-go brief, whose **Option (b)** Daniel approved: V2a = the approval
loop *only*; proactivity / quiet-moment queueing / morning brief deferred to **V2b**; the
engineering-debt backlog split out to a separate **Atlas maintenance** card.

## 0. One-line intent

**Voice stages an approval; Daniel's WebAuthn passkey tap commits it.** Atlas never commits an
approval and never becomes a path weaker than the shipped D2.12 T3 bar. A new MCP tool
`stage_approval` writes (or moves) a card to the existing `approvals` boundary and stops there; the
already-shipped dashboard WebAuthn path (`POST /api/approvals/verify`, D2.3/D2.4) is the *only* thing
that commits. This preserves the V1 trust floor with **exactly one narrowly-scoped, human-directed
exception** (gate Decision 1): Atlas performs **exactly one transition class — `inbox → approvals` —
and only on Daniel's spoken direction, never autonomously.** Everything else is unchanged: Atlas
never claims, self-assigns, executes, or transitions a card in any other direction; everything it
does is read-only or lands as a supervised card, and it never commits an approval or becomes a path
weaker than the shipped D2.12 T3 bar.

## 1. Scope

V2a adds exactly one capability: a **voice front-end to the human approval gate**, split across a
hard trust boundary.

- **Voice STAGES** — two operating modes, both human-directed and both gated by the §5 readback +
  action-echo confirm (gate Decision 1, "surface + move"):
  - *Surface mode.* Atlas surfaces a card **already** sitting at the approval boundary
    (`queue/approvals/`) — including cards Atlas did not itself file (e.g. a fleet-produced merge)
    and workflow-launch approvals — reads it back in full, takes the confirm, and calls
    `stage_approval` to present it in the dashboard Human Inbox as a Decision awaiting verification.
  - *Move mode.* On Daniel's explicit spoken direction only, Atlas may **move** an eligible card
    `inbox → approvals` (the one transition class it is permitted, §0). The move itself requires the
    same full readback + action-echo confirm before it executes, is audited with a transcript
    reference, and **never** fires from a proactive/ambient/timer context (there are none in V2a).
  - In both modes staging mints **no approval**; it only routes a card to the place where a human
    *can* approve it. The commit is still the passkey, always.
- **Passkey COMMITS.** Daniel taps his WebAuthn passkey in the dashboard, exactly as he does today
  (`buttonsFor(card)` → WebAuthn button → `POST /api/approvals/verify` with `channel: 'webauthn'` →
  `driveVerify` → `scripts/webauthn_verify.py` dispatcher-side assertion re-check → pinned-content
  execute + ops audit row). **No Atlas code path touches that route, the passkey, the credential
  store, or the assertion.** V2a changes nothing on the commit side; it only feeds the boundary.

Checkpoint (§9): Daniel speaks a real gated action to Atlas, hears the full readback, confirms by
echoing the action, watches the card appear as a Decision in the Human Inbox, taps his passkey, and
sees it commit and audit — one end-to-end spoken-stage / passkey-commit of one real T3 action.

**Sequenced, like V1:** the `stage_approval` tool + readback discipline land first as testable
units; the desk end-to-end is the closing human gate. No dashboard write-back is added — the
dashboard remains the read-only mirror V1 reaffirmed, plus the *already-existing* WebAuthn verify
route (which Atlas does not call).

**Deferred (named so they don't silently vanish) → V2b:** proactivity rules, quiet-moment queueing,
morning brief on request. **→ Atlas maintenance card:** `app.py` extraction (444 lines), console
`--input-device` by name substring, TTFT diet, spoken voice-switch, Bluetooth hot-follow output
routing, SSE panel push (replacing the 1s poll), Agent SDK typed task events. Neither set is V2a
scope and neither is designed here.

## 2. Where this rides in the substrate (integration points, real files)

Atlas keeps its single integration boundary — the kb-MCP server (`atlas/kbmcp/`) — and the dashboard
keeps its already-shipped approval surface. V2a wires the two through the *card queue*, never through
a new channel.

**The commit side already exists and is untouched by V2a.** For reviewers, the load-bearing files:

- `dashboard/server/approvals/routes.ts` — `GET /api/approvals` (read-only corroboration feed) and
  `POST /api/approvals/verify` (session-gated; the WebAuthn channel performs the dispatcher-side
  assertion re-check that *is* the T3 boundary). Atlas calls **neither**.
- `dashboard/server/approvals/inbox.ts` — `driveVerify(cardPath, channel, deps)` shells the verifier
  for the card's channel; only a `webauthn` success triggers the pinned-content `execute`. The
  verifier prints one JSON line and **never writes `queue/`** — the pinned `.card` bytes are the sole
  authority. Unchanged.
- `dashboard/server/approvals/humanInbox.ts` — `classify()` surfaces any `state === 'approvals'` card
  as a **Decision** with `buttonsFor(card)` gating, and treats an `approve:*` action as an operator
  gate via `isHumanGate()`. This is where a staged card *appears* for Daniel. **One additive change
  in V2a** (gate Decision 2): a card carrying the `staged-by: atlas-voice` marker (§3.5) renders a
  distinct **"voice-staged"** badge with a link to the session transcript, so Daniel can see at a
  glance that Atlas routed it and can open the spoken-confirm trail before he taps. The classification,
  gating channels, and commit path are otherwise untouched — the badge is presentation-only and
  changes nothing about how the card is verified.
- `dashboard/server/approvals/assurance.ts` — `buttonsFor(card)` decides, purely from the
  fleet-emitted `card.meta.assurance_class`, which channels a card offers. A novel/first-ever T3
  (`T3-novel`) or any unknown class fails closed to **signed + WebAuthn only** (no possession/tap).
  V2a inherits this fail-closed cutline unchanged.
- `scripts/webauthn_verify.py` (D2.3) + the SHA-anchored credential store (D2.12, passkey armed for
  localhost, sentinel pinned) — the actual assertion verifier. **Not read, not touched, not proxied**
  by Atlas.

**The stage side is the only new code.** `stage_approval` rides the *existing* `file_card` mechanics
(V1 §6): `scripts/cards.py` → write a card into `queue/` on the **ops** worktree via the same
injected git seam V1 already uses (pull-rebase-before-write, rejected-push→reconcile→retry). The one
difference from `file_card` is the target state/section — see §3. No new vendor, no new key, no new
route, no new credential. Same key-free discipline that made V1's `GET /state` provably key-free: the
worker's process env never appears in a staged card, and `stage_approval` never reads it.

## 3. The `stage_approval` MCP tool (new — the only new surface)

Added to the single tool registry (V1 §6 consolidated the four edit-sites into one). Signature is
deliberately narrow and mirrors `file_card`:

```
stage_approval(card_id, mode, readback_ack, session_transcript_ref) -> { staged: bool, card_id, state }
    mode: "surface" (card already in approvals/) | "move" (inbox → approvals, spoken-directed only)
```

**Contract (binding):**

1. **Stages only, never commits.** Its sole effect is to place an existing card at the approval
   boundary (`state: approvals`, file in `queue/approvals/`) so the Human Inbox shows it as a
   Decision — either by surfacing a card already there (`mode: surface`) or by moving one from
   `inbox` (`mode: move`, §3a). It writes **no** `approval` field, **no** approval record, **no**
   assurance verdict — those are minted only by `scripts/webauthn_verify.py` behind Daniel's passkey.
   If a caller ever supplies an `approval`/`verified`/`assurance` value, the tool rejects the call.
2. **Never touches a credential/passkey as an object.** It does not read, create, or reference the
   credential store, the WebAuthn assertion, the challenge/nonce, or any key. It cannot — it only
   moves a card file. This is the credentials-as-objects hard ceiling; flag loudly in review.
3. **Operates on a card Atlas did not mint the authority for.** `stage_approval` takes an existing
   `card_id` (Atlas's own, or one the fleet filed — gate Decision 1 explicitly allows staging cards
   Atlas did not file, including workflow-launch approvals). It does **not** invent the gated action
   inside the approval call — the action, target, and risk-tier are whatever the card already carries
   and were minted through the normal card path. Staging is a *routing* act, not an *authoring* act.
   **Target restriction (gate Decision 2): T3 gated targets only** — the tool refuses to stage a card
   whose `risk-tier` is not T3 (T1/T2 are approvable over weaker channels already; voice-staging them
   adds no value and needlessly widens the surface).
4. **Read-back is structurally required — for both modes.** Like V1's `file_card` (`confirmed: true`
   schema flag), the tool requires `readback_ack` — a boolean the LLM may only set after it has read
   the card's **action verb + target + risk tier + scope** aloud and received an explicit confirm
   that **echoes the action verb + target** (§5). Persona/system instructions carry the standing
   rule; the schema makes a bare call impossible. The `move` mode is gated identically — a move is
   never performed without the same readback + echo-confirm.
5. **Auditable surface.** The staged card is stamped so the surface is traceable exactly like
   `file_card`'s `workflow: atlas-voice` stamp — a `staged-by: atlas-voice` marker plus the
   `session_transcript_ref` linking to the voice transcript ledger (V1 §5), so every staging (and
   every `move`) has a retained spoken-confirm trail alongside it. The `staged-by` marker also drives
   the Human Inbox "voice-staged" badge (§2, gate Decision 2).
6. **Supervised, per contract.** `orgs/atlas/contract.md` classes filing-on-behalf-of-the-user as
   *queues-for-me* (supervised until graded). Staging is the same posture: it queues a decision *for
   the human*, it does not act. It never appears in `acts-alone`.

### 3a. The `move` mode — the one permitted transition, with guardrails

Gate Decision 1 authorizes a single, deliberate exception to V1's "Atlas never transitions" floor:
Atlas may move a card `inbox → approvals`. This is the *only* transition Atlas may ever perform.
Guardrails (all binding):

- **Human-directed only.** A move fires only in response to Daniel's explicit spoken direction inside
  an engaged session. There is no proactive, ambient, or timer path that can trigger it (V2a has no
  proactivity at all — that is V2b). This is enforced by the fact that `stage_approval` is only ever
  called from the tool loop of a live engaged turn, never from the done-watcher or any background task.
- **Same readback + echo-confirm as staging.** The move executes only after the full readback and an
  action-verb + target echo-confirm (§5). A misheard or ambient utterance cannot move a card because
  it cannot satisfy the echo-confirm; this is a named threat-model row (§7 #10).
- **T3-only, same as surface mode** (contract item 3): a move is refused for any non-T3 card.
- **Audited with transcript reference** (contract item 5): the moved card carries `staged-by:
  atlas-voice` + `session_transcript_ref`, so the transition is never silent.
- **Reverts are never silent** (gate Decision 2 TTL, §8-2). A staged approval carries a **15-minute
  TTL**; if Daniel has not tapped within the window, the card does **not** auto-revert to `inbox` and
  is **never deleted**. Instead it returns to an *approvals-pending* resting state with an explicit
  Human Inbox notice ("voice-staged approval expired, re-confirm to re-stage"), so an expired stage is
  always visible and recoverable, never a card that quietly vanished from the gate. (The exact
  mechanism — a TTL field the Human Inbox reads vs. a swept re-classification — is the one residual
  implementation question, §8 residual.)

**What `stage_approval` explicitly may NOT do:** commit or verify an approval; call
`/api/approvals/verify`; move a card in **any** direction other than `inbox → approvals` (never
`approvals → done`, never past the boundary, never `working →` anything); stage a non-T3 card;
self-assign or set `owner`; touch `ledgers/grades/**` or `ledgers/activity/**`; launch or execute
anything; fire from any non-engaged/ambient/timer context. Any of these voids the trust floor and is
a wake-me trigger.

## 4. Non-goals (binding)

- **Voice-only commit / "desk presence = identity" (the refuted bar).** The 2026-07-15 spec §9
  proposed that Atlas commit approvals itself under Daniel's git identity, justified by "anyone at the
  unlocked PC could already approve via browser; Atlas adds no weaker path." This is **refuted and
  out of scope.** Refutation rationale: (a) `governance/risk-tiers.md` (D2.13) pins **T3 → the
  dashboard/WebAuthn-signed channel ONLY; the weak/unsigned transport MUST NOT authorize a T3
  action** — a spoken confirm is exactly such a weak, unsigned, replayable transport. (b) D2.3/D2.12
  made the WebAuthn assertion (SHA-anchored credential store, dispatcher-side re-check) *the* T3
  boundary; a voice path that mints the approval bypasses that boundary by construction. (c) "Desk
  presence" is not authentication: a spoken phrase can be uttered by anyone in the room, replayed, or
  synthesized, and carries no cryptographic binding to Daniel's authenticator. The passkey tap does.
  V2a therefore keeps voice strictly on the *stage* side of the boundary; the commit stays on the
  passkey. (A later config-level relaxation remains theoretically Daniel's call, but is **not** in
  this design and would itself need a fresh gate — it is not assumed here.)
- **Proactivity, quiet-moment queueing, morning brief.** → V2b, after V1 desk soak informs them.
  Their unattended-execution and spend-creep risks are exactly what soak should shape.
- **Engineering-debt backlog** (`app.py` extraction, input-device-by-name, TTFT diet, voice-switch,
  Bluetooth hot-follow, SSE push, Agent SDK typed events). → a separate Atlas maintenance card. Not a
  Trust capability.
- **Any handling of a credential as an object** (create/read stores/modify), and **any unattended
  execution** — Atlas never claims, self-assigns, or executes; nothing runs on its spend-capped key.
  Unchanged hard ceilings. The one honest amendment (gate Decision 1): Atlas may perform exactly one
  transition class, `inbox → approvals`, and only on Daniel's spoken direction (§3a) — it still never
  transitions in any other direction and never autonomously.
- **Dashboard write-back from Atlas.** The dashboard stays the read-only mirror (V1 reaffirmed).
  V2a adds no route and calls no write route; the WebAuthn verify route is driven by Daniel's tap in
  the browser, not by Atlas.

## 5. The readback + action-echo confirm (the stage-side integrity control)

Staging is the one place voice touches the approval path, so the spoken discipline is the stage-side
analogue of the passkey — it does not *authenticate*, but it prevents a mishear or a loose "yes" from
parking the wrong card at the boundary. Mirrors and tightens V1's `file_card` read-back:

1. **Full readback before any stage or move.** Atlas reads back the card's **action verb + target +
   risk tier + scope signal** — the four fields fixed at the gate (Decision 2) — e.g. "T3 *merge* of
   *PR #NN into main*, scope 220-line diff, tests green." Drawn from the card's own frontmatter,
   never paraphrased into something softer.
2. **Action-echo confirm only — echo must name verb + target.** A bare "yes" is insufficient (carried
   from spec §9; fixed at the gate). The confirm must echo the **action verb and the target** — "yes,
   stage the *merge* of *PR-42*", "stage the *deploy* of *the dashboard*". If the echo is ambiguous or
   names only one of the two (verb without target, or vice versa), Atlas **re-asks** rather than
   staging (Decision 2). "Show me first" surfaces the card/diff on screen (read-only). "Reject" and
   "later" are first-class and stage nothing.
3. **Confirm gates the schema flag.** Only after (1) and (2) may the LLM set `readback_ack: true`.
   The persona carries this as a standing rule with a persona-test (the V1 confirm-rule test
   precedent); the schema refuses a stage — or a move — without the flag.
4. **The readback is a courtesy, not a credential.** It never substitutes for the passkey. Even a
   perfect readback + confirm only *stages*; Daniel's tap is still required to commit. This asymmetry
   is the whole design.

## 6. Prerequisite gates (in plan order)

Following the delta design's "every phase opens with a same-day sweep, closes with a desk checkpoint"
discipline. These are **binding gates**, not aspirations:

- **(P1) Same-day live passkey approval sweep — BEFORE any V2a build.** On the build day, prove the
  shipped WebAuthn commit path works end-to-end at the desk: a real card at `state: approvals`,
  tapped and committed via `POST /api/approvals/verify` (`channel: webauthn`), producing a verified
  ops audit row. This is the delta §5 "passkey approval loop verified live" opener. A failed sweep is
  a stop-and-reassess gate, not a plow-ahead. (P1 is a *build-day* verification, not a build blocker
  for authoring this spec.)
- **(P2) T3-grade adversarial security review as an explicit wave stage.** The approval loop is a T3
  security surface, not a feature (go/no-go risk #1). The wave includes a dedicated adversarial
  review stage — fresh-context, reading the `stage_approval` implementation and its tests against the
  invariants in §3 and the threat model in §7 — whose explicit job is to try to find a path by which
  voice commits, or by which staging opens anything weaker than the WebAuthn-signed channel. This
  stage must pass before the desk checkpoint.
- **(P3) Desk checkpoint = end-to-end spoken staging + passkey commit of one real gated action.**
  The closing human gate (§9). Daniel personally verifies the full loop on a genuine T3 action.

## 7. Threat-model sketch — ways the loop could degrade the T3 bar, and the invariant that blocks each

The design's job is to make it *structurally impossible* for the voice side to weaken the passkey
bar. Enumerated failure modes and the blocking invariant for each:

| # | Degradation path | Blocking invariant |
|---|---|---|
| 1 | **Voice commits directly** — `stage_approval` (or a sibling) writes an `approval` field / verified record. | The tool writes only card *state/location*; it rejects any `approval`/`verified`/`assurance` input and has no code path to the verifier. Only `scripts/webauthn_verify.py` behind the passkey mints an approval. (§3.1, §3.2) |
| 2 | **Staging forges a stronger assurance class** to unlock a weaker channel (e.g. stamps `T3-established` to surface a possession/tap button on a novel T3). | `assurance_class` is fleet-emitted (`promotion.decide()`), read-only to the dashboard; `buttonsFor` fails closed to signed+WebAuthn for anything it doesn't recognize, and `verify_telegram_approval`'s F4 check re-enforces "no possession for novel T3" dispatcher-side. `stage_approval` never sets `assurance_class`. |
| 3 | **Mishear / wrong card staged** — Atlas parks the wrong action at the boundary, and Daniel taps trusting the readback. | Full readback of action/target/risk-tier/scope from the card's own frontmatter + action-echo confirm gate `readback_ack` (§5); and the passkey commit shows the pinned card view — Daniel still sees what he is signing, independent of the spoken readback. |
| 4 | **Replay / spoofed voice** confirms a stage (someone in the room, a recording, TTS synthesis). | Staging is not authentication — a spoofed confirm can at worst *stage* a card; it cannot commit. The commit requires the WebAuthn assertion bound to Daniel's authenticator, which a voice replay cannot produce. (§4 refutation, §5.4) |
| 5 | **Weak-channel smuggling** — a staged card offers or routes to Telegram/possession for a T3. | `buttonsFor` + `POSSESSION_ADMISSIBLE` gate channels from assurance class, not from who staged; a T3-novel card shows only signed+WebAuthn. `stage_approval` cannot alter that. D2.13 rule holds: weak transport MUST NOT authorize T3. |
| 6 | **Credential-as-object leak** — the tool reads/persists the passkey, credential store, or an assertion. | `stage_approval` only moves a card file; it has no reference to the credential store, challenge, nonce, or assertion. Provably key-free like V1 `/state`; the worker's process env never enters a staged card. (§3.2) |
| 7 | **State-jump** — staging transitions a card past `approvals` (to `done`/executed), skipping the gate. | The tool's only legal target is `state: approvals` / `queue/approvals/`; it may not write `queue/done/`, set `owner`, or transition beyond the boundary. Anything else voids the trust floor (wake-me). (§3 "may NOT do") |
| 8 | **Unattended staging loop** — Atlas stages on its own initiative / on a timer, flooding the gate. | Staging happens only inside an engaged session after a spoken readback+confirm; there is no proactive/timer path in V2a (proactivity is V2b, explicitly out). Contract keeps staging *queues-for-me*, never `acts-alone`. |
| 9 | **Audit gap** — a staged (or mis-staged) card leaves no trail. | Every stage is stamped `staged-by: atlas-voice` + `session_transcript_ref` into the retained voice transcript ledger (§3.5); the commit path already writes an ops audit row on success (`routes.ts` FINDING 3). |
| 10 | **Unintended `inbox → approvals` move** — ambient speech, a recording, or a misheard command triggers the new move transition (gate Decision 1) and parks a card at the gate Daniel never meant to advance. | The move requires the same full readback + **action-verb + target echo-confirm** (§5) — ambient/misheard input cannot produce the specific two-part echo, and ambiguity forces a re-ask, not a move; the move is **T3-target-only** (a non-T3 card cannot be moved at all); it fires **only** from a live engaged tool loop (no proactive/ambient/timer path exists in V2a); and every move is **audited** with `staged-by: atlas-voice` + transcript reference, so an unintended move is always visible and reversible (and its 15-min TTL returns it to approvals-pending with an Inbox notice, never a silent revert or delete — §3a). Worst case it *stages* a T3 card; it still cannot commit — the passkey is required. |

The invariant that subsumes the table: **voice can only ever move a card *to* the boundary — and only
that one `inbox → approvals` direction, only on Daniel's echo-confirmed spoken direction; crossing the
boundary requires the passkey, which voice cannot reach, forge, or replay.**

## 8. Resolved decisions (2026-07-21 conversation gate)

Every open question raised in the draft was settled by Daniel at the gate. The two substantive rulings
were **Decision 1 (authority / "surface + move")** and **Decision 2 (a bundle of accepted defaults)**;
recorded here with rationale so the plan is written against fixed answers, not assumptions.

1. **Authority — "surface + move" (Decision 1).** `stage_approval` may act on **any** card already in
   `queue/approvals/` — including cards Atlas did not file and workflow-launch approvals — **and** may
   additionally **move** a card `inbox → approvals` when Daniel directs it by voice. This is a
   deliberate, human-directed exception to V1's "Atlas never transitions" floor, reframed honestly in
   §0/§3a: *Atlas performs exactly one transition class — `inbox → approvals` — only on Daniel's
   spoken direction, never autonomously.* Guardrails (all in §3a): the move requires the same full
   readback + action-echo confirm; it is audited with a transcript reference; it never auto-triggers
   from a proactive/ambient context (none exist in V2a); and a moved-then-untapped/expired card does
   **not** silently revert — expiry returns it to an approvals-pending resting state with an Inbox
   notice, never a delete. *Rationale:* the highest-value voice flow is "advance this to the gate for
   me," which needs the move; the risk (an unintended move) is contained by the echo-confirm + T3-only
   + audit invariants (new threat row §7 #10), and the passkey still commits, so voice never crosses
   the T3 boundary.
2. **Which states/tiers may be targeted → T3 gated targets only (Decision 2).** T1/T2 are approvable
   over weaker channels already, so voice-staging them adds no value and needlessly widens the surface.
   The tool refuses any non-T3 card (§3 item 3). *(Answers draft Q1.)*
3. **May Atlas stage a card it did not file → yes** (Decision 1), including fleet-produced merge cards
   and workflow-launch approvals. Staging is routing, not authoring (§3 item 3). *(Answers draft
   Q2/Q9.)*
4. **Staging-card TTL → 15-minute auto-expiry** (Decision 2). If Daniel has not tapped within 15 min,
   the staged approval expires; it does **not** auto-revert to `inbox` and is **never deleted** — it
   returns to an approvals-pending resting state with an explicit Human Inbox notice, so an expired
   stage is always visible and recoverable (§3a). *(Answers draft Q3.)*
5. **Readback contents → action verb + target + risk tier + scope** (Decision 2), drawn verbatim from
   the card's frontmatter (§5.1). *(Answers draft Q4.)*
6. **Confirm strictness → echo must name verb + target; ambiguity → re-ask** (Decision 2). A bare
   "yes", or an echo naming only one of the two, does not stage — Atlas re-asks (§5.2). *(Answers
   draft Q8.)*
7. **Error / failure UX → spoken AND surfaced in the Human Inbox** (Decision 2). A failed stage/move,
   an unreachable-ops git rejection, or a failing P1 sweep is both spoken back to Daniel and surfaced
   as a Human Inbox item, never a silent drop. *(Answers draft Q5.)*
8. **Human Inbox presentation → distinct "voice-staged" badge + transcript link** (Decision 2). A
   card carrying `staged-by: atlas-voice` renders a distinct badge linking to the session transcript;
   this is the one additive `humanInbox.ts` change in V2a (§2). *(Answers draft Q6.)*
9. **The `inbox → approvals` move is permitted** (Decision 1), resolving the draft's sharpest boundary
   question (Q7): yes, with the §3a guardrails and the honest §0 reframing of the transition invariant.

### Residual implementation questions (non-blocking; for the plan, not a fresh gate)

- **TTL mechanism.** *How* the 15-min expiry is realized — a `staged-at`/`expires-at` field the Human
  Inbox reads and renders as expired, vs. a periodic sweep that re-classifies the card — is an
  implementation choice for the plan. Either satisfies Decision 2's "never silently revert or delete"
  requirement; no TTL machinery exists in the read code today, so this is a build detail, not a design
  gap.
- **"Scope" field composition.** The readback's *scope* signal (Decision 2) will be assembled from
  whatever the card frontmatter carries — diff size, test state, PR number as available — with a
  graceful fallback when a field is absent. Exact assembly is a plan-time detail; the four required
  fields themselves are fixed.

These residuals are settled during planning/implementation under the normal wave review; they do not
reopen the conversation gate.

## 9. Human checkpoint (closing gate)

**Gate:** end-to-end, on a real gated action. Daniel speaks the action to Atlas → hears the full
readback (action verb + target + risk tier + scope) → gives a verb + target echo-confirm → Atlas calls
`stage_approval`, the card lands in `queue/approvals/` → Daniel sees it as a Decision in the dashboard
Human Inbox with the WebAuthn button → he taps his passkey → the existing verify path commits it and
writes the ops audit row. Verified personally, like V0's loop and V1's card-by-voice. A miss anywhere
is a stop-and-reassess, not a plow-ahead.

## 10. Verification strategy

V1/V0 discipline unchanged — everything testable without audio hardware, and the security surface
tested hardest:

- **`stage_approval` unit tests** against the conftest `kb_fixture` (real card schema) + a throwaway
  git repo with a local bare remote for the ops seam (the V1 §5/§10 pattern). Assert: it writes only
  state/location; it rejects `approval`/`verified`/`assurance` inputs; it never sets `owner`,
  `assurance_class`, or a done state; it never reads process env; the `staged-by` + transcript stamps
  are present.
- **Boundary tests** proving the tool has no reference to the credential store, verifier, or verify
  route — a grep-level and a call-graph assertion that `stage_approval`'s module imports nothing from
  the auth/approvals commit path.
- **Readback discipline** exercised through the REPL (typed, no audio): a stage is refused without
  `readback_ack`; a verb-only or target-only echo re-asks rather than stages (§5.2); a non-T3 target
  is refused; the persona confirm-rule test extends the V1 standing test to cover staging and moves.
- **`move`-mode tests**: `inbox → approvals` is the only transition performed; a move without
  `readback_ack` is refused; no move fires from a non-engaged/background context; the moved card is
  stamped and audited; an expired stage returns to approvals-pending with an Inbox notice (never a
  silent revert or delete).
- **Adversarial review stage (P2)** as a first-class wave node — the explicit T3 security review of
  the whole loop against §7.
- **Desk facts** (the spoken loop, the tap, the audit row) verified only at the §9 human gate.

## 11. Execution model

Same as V1 (§11 there): cards on ops (`project: atlas`, workflow e.g. `atlas-v2a`), implementers
Opus 4.8 or below (model self-reported AND orchestrator-verified), orchestrator reviews every diff
and owns pushes/ops writes, inspector grades fresh-context, human gates one at a time. Named gates:
**P1** = same-day live passkey sweep (build-day opener), **P2** = T3 adversarial security review
(explicit wave stage), **P3 / §9** = desk end-to-end checkpoint. Work branch `claude/atlas-v2a`
(worktree under `C:/Users/danie/kb-worktrees/`), one PR at wave end unless review says split. This
design doc was the conversation-gate artifact; **Daniel settled its design decisions at the gate on
2026-07-21** (§8). The wave above still awaits Daniel's explicit build go; when given, it begins
with the P1 build-day sweep — no build code before it.
