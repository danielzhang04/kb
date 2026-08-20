# Agent-builder guidelines

Use these judgment rules after the workflow in `../SKILL.md` has triggered. They do
not replace the constitution, a project contract, or a human approval.

## Mandate

A good mandate names an observable job, bounded inputs, allowable outputs, and the
human decision that remains outside the agent. It says what the agent produces, not
only an aspiration such as “keep the fleet healthy.” Pair it with non-goals that
block the tempting but unsafe shortcuts.

Prefer this shape:

```
Read <named evidence>; produce at most <N> <named drafts> for <named targets>.
Never edit those targets, change <prohibited surfaces>, or convert a draft into approval.
Done is <machine-observable condition>; otherwise <named escalation>.
```

The definition is for differences unique to that agent. Do not repeat shared preamble,
memory, branch, secret, approval, or card rules: agents already inherit the kit and
the governing layers. Duplication drifts and can falsely look like extra authority.

## Right-size a loop

Use a one-shot card for work that does not recur. For a recurring job, express a
per-fire bound in every dimension that can grow: cycles/retries, source items, drafts
or actions, delegation fan-out, and time or tool calls where material. State an
observable completion condition, a no-progress condition, and a human escalation.

Choose a cap that lets one fire make a coherent, reviewable proposal. A cap is not a
goal: “five drafts maximum” needs “sources exhausted or cap reached” and must not make
the agent invent weak drafts merely to reach five. Do not let the agent schedule,
arm, accept, merge, or grade its own result.

## Put a rule in the owning layer

| Rule type | Home |
| --- | --- |
| Shared doctrine, safety floor, and task routing | kit/governing layers |
| Canonical declaration, memory, and initial eval scaffold | factory |
| Common minimum behavior measurable for every agent | `_fleet` evals |
| Runtime/model routing or a policy shared by a role | role policy, proposed for the human owner |
| A particular agent's mandate, local bounds, surfaces, and non-goals | that agent definition |

If a rule is relevant to more than one agent, do not clone it. Propose its owner-layer
change and explain which agents would inherit it. Never edit governance directly.

## Eval-card quality

An eval card is a narrowly falsifiable claim, not a flattering description. Its
frontmatter uses the suite contract: `id`, `capability`, `judge`, `rubric_version`,
`k`, `source`, `immutable`, `tier`, and judge-specific `input`; its filename is
`<id>.md`. Give it a concise body explaining the claim and a judge that can fail for
the failure mode it addresses.

Required `input` fields are `path` for `file-exists`; `command` plus `contains`
or `expect_empty` for `output-contains`; `test_file` for `pytest`; and
`prompt_file` for a model judge. The following are minimal valid deterministic
card frontmatters (add a concise claim as the body):

```yaml
# file-exists
id: required-file
capability: example
judge: file-exists
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T1
input:
  path: path/to/required-file
```

```yaml
# output-contains
id: required-output
capability: example
judge: output-contains
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T1
input:
  command: ["{python}", "-c", "print('OK')"]
  contains: "OK"
```

```yaml
# pytest
id: required-behavior
capability: example
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T1
input:
  test_file: path/to/test_required_behavior.py
```

Choose deterministic judges first:

- `file-exists` for a required generated artifact;
- `output-contains` for a stable required output fragment;
- `pytest` for behavior that needs a hermetic executable assertion.

Use `judge: model` only for a residual qualitative property that cannot be reduced to
a deterministic oracle; mark it as opt-in and pair it with deterministic boundary
checks. Do not use a model judge to approve authority, safety, or a manifest.

Draft one card for the core job and at least one for each material failure mode when
the failure can be judged. If it cannot, write the limitation and a human review
question instead of pretending it is tested. Cards stay drafts until a human reviews
the suite and runs the explicit manifest blessing command. Never bless a manifest as
part of authoring or verification.

## Names and ids

Use concise lowercase, hyphen-separated ids: `agent-maintainer`,
`ledger-reader`, `ledger-reader-no-governance-write`. Start from the job, not the
model or a person's name. Keep agent ids unique and avoid the reserved worker ids
`eval-suite` and `canary-suite`.

Use the same safe lowercase-hyphen form for eval ids; name the behavior or failure
being checked (`draft-cap-enforced`, `refuses-governance-write`), not the implementation
detail. Each eval card id must be unique within its suite and match its filename.

## Stop walls

Governance additions, changed governance policy, scheduling, cadence arming, manifest
blessing, and final acceptance belong to people. Create a human-owned draft card with
the evidence and proposed wording instead of performing any of them.

No agent authors or edits an eval that judges itself. When the current flow is acting
as the target agent, use an independent author for its suite and keep that separation
visible in the handoff.
