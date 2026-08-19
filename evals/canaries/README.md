# Canaries — the Proving Grounds golden suite (fleet-arc Wave B)

Each `*.md` file here is a **golden canary card**: a small, immutable, curated
test that the fleet's own substrate modules still behave. The runner
(`scripts/canary.py`) executes them all in-process against the repo's real code
— no network, no model calls, a fresh tmp fixture per canary.

## Card format

YAML frontmatter + a human-readable body:

```yaml
---
id: <unique-id>            # also the card_id used in recorded grade rows
capability: <capability>  # selects the deterministic checker (see below)
judge: deterministic      # every canary this wave is deterministic (pure Python)
rubric_version: "1"
k: 1                      # repeats; pass@k / pass^k machinery supports k>1
source: curated           # curated | prod-promoted
immutable: true           # golden cards are never edited in place
tier: T1                  # risk tier used when a grade row is recorded
input: {...}              # hermetic fixture parameters for the checker
expected: {...}           # the machine-checkable outcome
---
# body: what this canary guards and why
```

The `expected` block encodes the machine-checkable outcome (a value to match, a
`raises:` class, an `error_contains:` substring, or a count). The checker for
each `capability` builds the fixture from `input`, runs the real module, and
compares against `expected`.

### Capabilities (all `judge: deterministic` this wave)

| capability | what it exercises |
|---|---|
| `card-parse` | `cards.parse_text` / `cards.transition` — valid & invalid frontmatter, illegal transition, unowned-working refusal |
| `routing-resolution` | `routing.resolve` — role x tier table, unknown-model fail-loud, card precedence |
| `grade-schema` | `grade.record_grade` pinned schema (accept / reject extra / reject missing) + `promotion.trusted_grades` allow-list fail-closed |
| `preamble-gate` | `preamble.check` — STOP file present, ANTHROPIC_API_KEY set |
| `promotion-decide` | `promotion.status` — short/below-bar streak stays supervised; FROZEN sentinel fails closed |
| `ledger-shard` | `ledger.append`/`read_day` round-trip; `cost_today` |
| `reconcile-quarantine` | `reconcile.reconcile` — a wrong-author grade row is quarantined + freezes (built with a hermetic git repo in tmp) |
| `triage-taxonomy` | `triage_rules.classify` — the 4-tier email taxonomy |

Rubric-/Inspector-judged canaries (`judge: rubric`) are a **follow-on wave** —
they will dispatch the Inspector role rather than run a pure Python assert. All
21 canaries in this seed suite are deterministic.

## Immutability & the manifest

Golden cards must not drift silently. `evals/MANIFEST.sha256` records the SHA-256
of every canary file. `scripts/canary.py --all` verifies the manifest **before**
running anything; a mismatch (an edited or added/removed canary) aborts the suite
with exit code 2 (`canary-tamper`). This makes an accidental or adversarial edit
of an oracle fail loud instead of quietly changing what "passing" means.

Regenerating the manifest is a **human-gated act**:

```
py -3 scripts/canary.py --update-manifest
```

This is allowed only when the suite passes AND an `evals/` change is deliberate
(e.g. a human added a reviewed canary). Agents must not regenerate the manifest
to re-bless a change they made — that would defeat the immutability guard. In the
current single-machine topology the enforcement is (a) this manifest check and
(b) `--diff-guard <git-range>`, which flags any diff in a range touching
`evals/` (exit 3) and is wired into the self-lint cadence. When the
`governance/agent-rules.md` "canaries are human-promoted-only" amendment merges
to protected `main`, that becomes the durable rule.

## Running

```
py -3 scripts/canary.py --all                 # report-only: table + exit 0/1
py -3 scripts/canary.py --all --record        # ALSO append grade rows (record_grade)
py -3 scripts/canary.py --diff-guard A..B      # flag evals/ diffs in a git range
py -3 scripts/canary.py --update-manifest      # human-gated manifest regen
```

`--record` appends one grade row per canary through the existing pinned
`grade.record_grade` schema (`task_type=canary:<capability>`,
`inspector_id=inspector@agents.local`, `card_id=<canary id>`) — never a parallel
ledger. Default is report-only.

## How prod-promotion will work (later)

A canary with `source: prod-promoted` is one distilled from a real production
failure/success and promoted into the golden set by a human. The promotion flow
(a future wave): a candidate canary is proposed on a branch, reviewed, and — on
human approval — added here and the manifest regenerated in the same reviewed
commit. Until that flow exists, every canary is `source: curated`.
