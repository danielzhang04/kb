# DRAFT - ECC selective retention audit

Date: 2026-07-22
Owner: codex-worker
Branch: `codex/ecc-selective-import`

## Decision

Keep the full `ecc@ecc` plugin installed but disabled. Preserve demonstrated kb behavior through a
small kb-native allow-list instead of restoring ECC's complete discovery and hook surface.

## Evidence

Structured tool-call records in the 500 newest kb Claude JSONL files showed:

| Capability | Recorded use | Retention |
| --- | ---: | --- |
| `ecc:code-reviewer` agent | 13 invocations / 3 sessions | import lean `code-review` skill |
| `ecc:security-reviewer` agent | 3 invocations / 2 sessions | import lean `security-review` skill |
| `ecc:strategic-compact` skill | 1 invocation / 1 session | already curated |
| `save-session` skill | 1 invocation / 1 session | already curated |

Raw text matches were rejected as usage evidence because the plugin catalog itself was repeated in
session context, making every ECC name appear hundreds of times.

## Already retained and active

- Learning/session: `growth-log`, `save-session`, `strategic-compact`, and `loop-design-check`.
- Security/enforcement: `block-no-verify`, `hard-ceiling-guard` with the retargeted GateGuard
  classifier, and `config-protection`.
- Completion: warn-only `delivery-gate`.
- Import safety: Unicode, supply-chain IOC, provenance, and skill injection validators.
- Domain behavior: the chief-of-staff email taxonomy was rebuilt as kb's deterministic email-triage
  workflow rather than retained as an ECC catalog entry.

## New imported candidates

### `code-review`

Retains the demonstrated reviewer's high-value behavior: surrounding-context review, exact-line and
concrete-failure proof gates, defensible severity, zero-findings-is-valid discipline, proportionate
verification, merge simulation, and separate technical/governance verdicts.

Removed: automatic GitHub posting, generic package-manager commands, fixed coverage targets,
unrequested fixes, and stack-specific style thresholds.

### `security-review`

Retains evidence-based review of authentication, authorization, injection, filesystem, outbound
request, browser/API, sensitive-data, concurrency, dependency, configuration, and agent-system trust
boundaries.

Removed: package installation, network vulnerability scans, credential access, external alerts,
automatic fixes, and web-stack-specific boilerplate. kb governance remains authoritative.

The useful parts of ECC's `verification-loop` are folded into `code-review`; it has no structured
invocation evidence and does not justify another discovery entry.

## Explicit exclusions

- `continuous-learning` v1: deprecated.
- `continuous-learning-v2`: background observer/hooks, extensive user-state writes, remote import,
  pruning/deletion behavior, and a promotion model that conflicts with kb governance. Existing
  `growth-log`, memory, cards, and skill tiers cover the safe learning behavior.
- `security-scan`/AgentShield: downloads tooling, can mutate configuration, and has a key-dependent
  deep mode.
- ECC session registry/resume scripts: duplicate kb cards, memory, STATE, and dashboard controls and
  read/write user-level transcript state.
- Generic `git-workflow` and worktree orchestration: conflict with kb's stricter branch/ops/main
  rules and duplicate existing orchestration.

## Promotion result

Daniel approved both skills after the required full read-through on 2026-07-22. `code-review` and
`security-review` are promoted to `skills/curated/` with the approval stamp, and the authoritative
Claude/Codex skill mirrors are regenerated and verified as part of the promotion commit.

## Forward-test result

Fresh agents used the imported skills without receiving expected answers. Both independently found
that the context auditor's session scan was too broad; `code-review` also found an all-disabled
plugin-state counting bug. The implementation now leaves session JSONL untouched by default,
requires `--include-sessions` for telemetry, bounds candidate/file/record reads, reports limit events
and discovery completeness numerically, caps traversed directories/entries, excludes
symlinked/out-of-repo instruction files, and handles an explicit false-only plugin map correctly.
These findings validate the retained review behavior on a real branch.

## Promotion validation

- Repo-native skill validation, mirror drift checks, Unicode safety, and supply-chain IOC scans
  pass for both promoted skills and their Claude mirrors.
- Focused promotion/context/governance tests: 24 passed.
- Core repository suite: 628 passed, 9 skipped.
- Canary suite: 20/20 passed; the `origin/main...HEAD` diff guard is clean.
- A fresh bounded reviewer confirmed byte-identical mirrors, consistent manifests/catalogs, inert
  defaults, and no forbidden-path spillover.

The generic Codex skill-creator validator rejects kb's additional provenance keys because its
frontmatter allow-list does not implement kb's schema. The repository-native
`scripts/ci/validate_skills.js` validator is authoritative here and accepts the required metadata.
