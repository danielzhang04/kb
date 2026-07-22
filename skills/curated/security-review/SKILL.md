---
name: security-review
description: Review authentication, authorization, untrusted input, file or command handling, external requests, sensitive data, APIs, dependencies, and trust boundaries. Use for security audits, sensitive-code reviews, or security-sensitive changes. Read-only.
source: ecc@2.0.0/skills/security-review/SKILL.md + agents/security-reviewer.md
source-author: ECC contributors
source-hash: fe6f9151fb15c1dffd47a55080c3ad147af7c95dd0ad3714735dec6824b060b7 + c946d79ddd3e453400a2a858528c5510307912503e998b67fc114e73ee0dd144
imported: 2026-07-22
provenance-tier: curated
promoted: 2026-07-22 (Daniel full read-through approval)
---

# Security Review

Treat `governance/security-rules.md` and the target project's contract as authority. This skill is a
read-only review workflow. Do not open credential stores or secret-bearing files, install scanners,
make network calls, publish findings externally, or change code unless separately authorized.

## Map the trust boundary

1. Identify changed entry points, actors, privileges, data classes, and state transitions.
2. Mark every boundary crossed by user input, files, subprocesses, network destinations, model/tool
   output, plugins, webhooks, or persisted state.
3. Trace validation and authorization from entry point to sensitive operation. Do not assume an
   upstream check exists; inspect it.
4. Review surrounding configuration and tests without reading forbidden secret material.

## Review checklist

Check only categories relevant to the change:

- Authentication: session/token validation, expiry, replay resistance, and secure failure behavior.
- Authorization: ownership, tenant boundaries, role checks, object-level access, and confused-deputy
  paths. Authentication alone is not authorization.
- Input and injection: schema validation, SQL/query parameterization, shell arguments, template/HTML
  output, unsafe deserialization, and model/tool output treated as untrusted data.
- Filesystem: canonicalization, traversal, symlink behavior, archive extraction, unsafe globs, and
  destructive target validation.
- Outbound requests: destination allow-lists, redirects, private-address access, timeouts, response
  limits, and server-side request forgery.
- Browser/API boundaries: cross-site request protection, origin policy, content security policy,
  rate limits, error disclosure, and secure cookie behavior where applicable.
- Sensitive data: no secrets handled as objects, no credentials or private data in source, logs,
  errors, prompts, cards, memory, fixtures, or telemetry; verify redaction at the sink.
- State and concurrency: atomic authorization-plus-write, replay/idempotency, race conditions,
  partial failure, rollback, and auditability.
- Dependencies and configuration: lockfile/config changes, new install scripts, lifecycle hooks,
  executable downloads, permission expansion, and unsafe defaults. Use existing local scanners only;
  do not fetch tooling or vulnerability data during review without explicit authorization.
- Agent systems: prompt injection boundaries, tool-scope enforcement, untrusted retrieved content,
  memory poisoning, hidden external writes, and cost/runaway-loop controls.

## Evidence and severity

Before reporting a finding, cite the exact location, triggering input/state, sensitive operation,
bad outcome, and missing or bypassed guard. Inspect existing tests and framework guarantees. Do not
flag generic patterns without a concrete exploit or policy violation.

- CRITICAL: credible credential exposure, unauthorized privileged action, remote code execution, or
  destructive/data-loss path.
- HIGH: exploitable authorization, injection, traversal, request-forgery, or sensitive-data flaw.
- MEDIUM: defense-in-depth gap with a realistic precondition or meaningful missing regression test.
- LOW: bounded hardening improvement with clear value.

If a possible real credential is encountered, do not reproduce or inspect it further. Report only
its location/category and follow the repository's wake-up procedure.

## Report

List findings by severity with location, trigger, impact, evidence, and remediation direction. Then
state reviewed trust boundaries, local gates run, unverified areas, and a PASS, REQUEST CHANGES, or
BLOCK verdict. A clean review with zero findings is valid.
