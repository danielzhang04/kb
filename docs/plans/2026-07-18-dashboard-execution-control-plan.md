# Dashboard execution control plan

**Status:** Phase 1 implemented; Phase 2 partially implemented  
**Owner:** codex-worker  
**Scope:** Composer, workflow execution, Runs, Human Inbox, runner integration, and operator authentication

## Product outcome

The dashboard should behave like one personal agent operations console:

1. Daniel describes work in Composer.
2. Composer produces an inspectable task or multi-stage plan.
3. **Save definition** registers a reusable workflow. It does not imply execution.
4. **Run now** creates one durable run instance and its complete card DAG atomically.
5. Background runners claim runnable stages. Normal execution does not create visible Terminal tabs.
6. Runs shows the instance, stages, current owners, live state, results, and pauses.
7. Any decision, question, review gate, or failure that needs Daniel appears in one Human Inbox.
8. Daniel can respond, retry, stop, or approve from the relevant run without learning queue internals.
9. Contract-required review gates remain real gates. In particular, Atlas research output cannot be consumed downstream before its human review.

The Terminal remains a persistent manual/debugging escape hatch. It is not the workflow engine.

## Current truth

The existing UI overstates the backend:

- Composer chat is a read-only planning subprocess. Its answer is not converted into a structured draft.
- Deploying a workflow saves Markdown through the durable branch/PR path. Nothing compiles or runs it.
- Deploying a task files one card, but Composer does not assign an owner.
- Home Launch files a card. It does not trigger a runner or terminal.
- The only arbitrary-card runner is the scheduled Codex PowerShell runner. It runs once daily, only for `owner: codex-worker`, and publishes results on a `codex/*` branch awaiting a human/cloud merge into `ops`.
- There is no arbitrary-card Claude runner.
- Dependency release occurs on a later dispatcher cycle, and the Codex runner currently omits appended upstream results from the downstream prompt.
- Runs is one graph of every card, not a collection of run instances.
- Approvals only lists cryptographic approval-state cards. Verification does not approve, resume, or execute the card. Questions, wake-me failures, review waits, and runner failures are elsewhere or absent.
- Tasks, Runs, Workflows, and Agents do not live-refresh.
- Activity is not connected to an actual card/session transcript route.
- The PM2 daemon uses the feature checkout as both code and coordination data. Coordination writes correctly refuse unless that checkout is exactly `ops`, so launch can fail while development is on a feature branch.

## Semantics shown in the UI

| Action | Meaning | Expected result |
|---|---|---|
| Plan | Ask Composer to inspect the KB and propose work | Conversation and structured draft; no write |
| Save definition | Register reusable workflow content | Durable branch + review path; no run |
| Run now | Launch the reviewed draft as a one-off run | Atomic DAG, run id, background pickup |
| Save & run | Save a reusable definition and launch the current reviewed version | Two separately reported outcomes |
| Retry with feedback | Create a governed successor attempt | New stage/card linked to the original |
| Stop | Request cooperative stop, then escalate if the runner does not acknowledge | Visible stopping/halted state |
| Verify evidence | Check an already-present approval proof | Verification result only; never falsely labeled execution |
| Approve / respond | Record a content-bound human decision or answer and resume the paused stage | Requires the dedicated human-interaction write path |

## Execution architecture

### Coordination checkout

Code and coordination data need separate roots:

- PM2 runs dashboard code from the reviewed dashboard checkout.
- `DASHBOARD_REPO_ROOT` points to a dedicated `ops` worktree used only for Plane-A reads and governed coordination writes.
- Workers use separate worktrees. A worker must never switch the dashboard code checkout to `ops`.
- Startup health reports both code revision and coordination root/branch; write readiness is false unless the coordination root is a clean `ops` checkout.

### Workflow run v1

The first executable format is intentionally small and strict:

```text
name, project
stages[]:
  id, action, target, workOrder, riskTier, owner, dependsOn[]
```

Server invariants:

- stage ids are safe and unique; referenced dependencies exist; the graph is acyclic;
- a bounded stage count prevents accidental fan-out;
- v1 Run now accepts T1/T2 only; T3 must enter the approval path;
- every owner belongs to the server-side assignable/runnable registry;
- runtime and model are resolved and stamped server-side, never trusted from the browser;
- one generated run id is stored in the existing `workflow` card field;
- roots start in `inbox`; dependent stages start in `blocked`;
- all cards and the audit row are created/committed atomically after preamble, origin, rate, and WebAuthn-session gates.

Reusable Markdown definitions should embed or point to the same versioned data shape. A later parser must reject prose-only legacy definitions as not runnable rather than guessing stage boundaries.

### Runner boundary

The correct normal experience is a background runner, not dashboard-spawned xterm tabs.

The safe delivery sequence is:

1. Launch the v1 DAG and expose accurate `queued / blocked / awaiting runner` state.
2. Add an immediate trigger for an already-provisioned runner after the coordination commit.
3. Move each runner to its own worktree and make repository roots explicit parameters.
4. Deliver upstream results to a downstream prompt in an explicitly inert dependency-results block.
5. Feed worker events/results back into canonical coordination state through the reviewed runner/broker boundary.
6. Add the Claude adapter.

The existing Codex worker may not be granted direct `ops` mutation or GitHub REST capability as a shortcut. Its registered trust boundary requires result branches and human/cloud integration. A different automatic result-ingress design needs an explicit security review. The already-built Broker is likewise gated by the documented subscription-ToS and threat-review gates; this plan does not silently activate it.

### Human Inbox

One destination aggregates human-attention records, with honest categories:

- **Decision:** cryptographic approvals and contract review gates;
- **Input:** an agent question or requested feedback;
- **Intervention:** wake-me, failed runner, stopped/stuck stage, or integration wait.

The initial implementation can classify existing cards read-only. Full interaction requires a durable human-request record containing run id, stage id, prompt/context hash, response type, and resume target. Approval verification and human decision are separate operations.

### Authentication

No private passkey is sent to the dashboard. Windows Hello signs a challenge locally. The product copy should say **Unlock dashboard**, not imply key transfer.

The binding dashboard threat model explicitly says localhost is not authentication, because another local process is a named adversary. Therefore normal consequential actions retain a WebAuthn-backed session. Friction is reduced by persisting one valid session across refresh, tracking expiry, renewing at point of action, showing useful errors, and using a configurable work-session TTL. T3/content-bound approvals remain explicit.

## Delivery phases

### Phase 1 — truthful executable vertical slice

- [x] Persist/renew the operator session; replace key-transfer wording; repair Approvals point-of-action auth.
- [x] Add strict atomic `POST /api/write/workflow-runs`.
- [x] Give Composer Task an owner and make Workflow a structured stage editor.
- [x] Split Save definition from Run now.
- [x] Add Run buttons in Workflows for runnable v1 definitions.
- [x] Group Runs by run id and live-refresh it.
- [x] Replace visible Approvals with Human Inbox and aggregate existing attention states.
- [x] Report runner trigger/availability outcomes honestly.
- [x] Configure dedicated `ops` and durable-save worktrees for the daemon.

### Phase 2 — automatic background execution

- [x] Parameterize worker roots and provision a separate worker worktree.
- [x] Trigger runner pickup immediately after successful launch.
- [x] Pass the card-stamped model to Codex.
- [x] Include dependency results as inert downstream context.
- [ ] Add a canonical, security-reviewed result-ingress path so stages advance without manual queue reconciliation.
- [ ] Add a Claude subscription runner adapter or activate the reviewed Broker fallback.
- [ ] Show transcript/log events per run stage.

### Phase 3 — real human interaction and steering

- [ ] Add durable question/review/intervention records and `waiting-human` semantics through a human-reviewed schema proposal.
- [ ] Implement content-bound Approve/Reject/Respond and resume transitions.
- [ ] Add independent desktop/phone notifications.
- [ ] Add feedback-at-checkpoint for external runners.
- [ ] Activate graceful in-turn steer only after the Broker gates pass.

## Acceptance scenarios

### One-off task

Composer → Task → owner `codex-worker` → Run now creates one run/card → Runs shows queued → background pickup changes it to working → result appears → run completes or clearly says it is awaiting integration.

### Research then Atlas

Composer creates Research → Human review → Atlas build. Research runs first. The Atlas stage stays blocked at the review gate. Human Inbox shows the draft and response controls. Only an explicit approval releases Atlas.

### Failure

A runner error appears once in Human Inbox and on the run stage. Daniel can retry with feedback. The retry is a new governed attempt; the failed history remains visible.

### Authentication

Daniel unlocks once, refreshes the page, and continues normal T1/T2 work while the session is valid. Expiry causes one understandable point-of-action unlock, not a silent 401. T3 still asks for explicit content-bound confirmation.

## Non-goals for this pass

- Do not use Terminal tabs as fake workflow processes.
- Do not infer a runnable graph from arbitrary Markdown prose.
- Do not bypass project contracts or high-risk approval gates.
- Do not activate the Broker or widen worker credentials without their documented human reviews.
- Do not add a second database; git/cards remain coordination truth.
