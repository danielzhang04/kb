---
name: code-review
description: Review a branch, commit range, or PR for correctness, security, maintainability, verification, and merge readiness. Use for code audits, reviews, merge checks, pre-merge checks, or PR review. Read-only unless fixes are separately requested.
source: ecc@2.0.0/commands/code-review.md + agents/code-reviewer.md
source-author: ECC contributors
source-hash: 20f4b8fcf132d6563ae0afb3d6d695ac8d4d85f3d36b15da83de30b041cce107 + 07447dbe8733fb9e24b1016d52b62468748b27547b5cff7af3021f3436624ee5
imported: 2026-07-22
provenance-tier: curated
promoted: 2026-07-22 (Daniel full read-through approval)
---

# Code Review

Review evidence, not appearances. A review request authorizes read-only inspection and verification;
it does not authorize fixes, commits, pushes, merges, reviews posted to a forge, or coordination
writes.

## Establish the review target

1. Run the repository preamble and load its binding instructions.
2. Identify the base, head, dirty worktree state, and complete changed-path list.
3. For committed work, review `base...HEAD`; for uncommitted work, include staged and unstaged
   changes. Use remote or pull-request metadata only when requested and available through an
   already-authorized read path.
4. Simulate the merge without changing the working tree when the Git version supports it.
5. Separate technical merge readiness from the repository's human approval and risk-tier rules.

## Read enough context

- Read every changed implementation and test file in full.
- Trace relevant callers, imports, configuration, schemas, and error paths.
- Check the intended behavior against the task, plan, contract, or acceptance criteria.
- Do not report an issue in unchanged code unless it is a critical vulnerability directly exposed
  by the change.

## Apply the finding gate

Report a finding only when all answers are yes:

1. Can you cite the exact file and line?
2. Can you name the triggering input or state and the concrete bad outcome?
3. Did you inspect the surrounding context and existing guards?
4. Is the severity defensible under this repository's conventions?

For HIGH or CRITICAL findings, include the relevant snippet, the complete failure scenario, and why
types, validation, tests, or framework behavior do not catch it. Downgrade or omit speculative
findings. A zero-finding review is valid.

## Review dimensions

Inspect, in order:

1. Correctness and behavioral regressions.
2. Security and trust-boundary changes. Invoke `security-review` for auth, untrusted input, command
   execution, file paths, external requests, sensitive data, or permission changes.
3. Data loss, destructive behavior, concurrency, retries, and partial-failure handling.
4. Contract, type, schema, and compatibility changes.
5. Missing or misleading tests and verification gaps.
6. Performance regressions with a realistic trigger and material impact.
7. Maintainability problems that make future defects likely; skip style preferences.

## Verify proportionately

Discover commands from repository instructions and project manifests. Do not install or download
tools as part of review.

1. Run formatting/diff hygiene and repository policy guards.
2. Run focused tests for changed behavior.
3. Run the relevant full suite when the repository defines one or the change has broad impact.
4. Run type, lint, build, security, or canary gates that apply to the changed paths.
5. Classify infrastructure failures separately from product-test failures. Retry only with a safe,
   bounded environment correction.
6. Record exact pass/fail/skip counts and commands. Never claim a gate ran when it did not.

## Decide and report

Use these severities:

- CRITICAL: exploitable security issue, credential exposure, or credible data-loss path; block.
- HIGH: concrete bug or policy violation likely to affect users or integration; request changes.
- MEDIUM: real but non-blocking defect or meaningful missing coverage.
- LOW: optional improvement with a demonstrated benefit.

Lead with findings ordered by severity. For each, give location, trigger, outcome, evidence, and the
smallest useful fix direction. Then report:

- technical verdict: READY, READY WITH COMMENTS, REQUEST CHANGES, or BLOCK;
- verification evidence and any unverified gate;
- merge/conflict and branch-divergence state;
- repository governance or human-approval gates, separately from technical quality;
- reviewed files and explicit scope exclusions.
