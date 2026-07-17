# Proposal — Gemini-deferred governance note (Human Gate 5.11)

**Status:** proposal only. Daniel commits this on `main`; agents cannot write under `governance/`.

## Where

Append as a one-line note to `governance/security-rules.md` (the plan offers "or the spec";
security-rules.md is the better home — it is the governance surface future onboarding decisions
will be checked against).

## Exact line to add

> Gemini is deferred for month 1 on privacy grounds — its free tier trains on submitted data; the
> month-1 non-Claude worker is Codex CLI only. The adapter pattern remains generic for a future
> capped/paid or privacy-cleared Gemini path.

## Context

Wave-5 build kept every extension point generic per this decision: `sync_skills.RENDERERS` ships
only `render_codex` but takes a one-entry addition for `render_gemini`;
`docs/onboarding/one-off-agent.md` is written CLI-agnostic and names Gemini as deferred-not-dropped.
