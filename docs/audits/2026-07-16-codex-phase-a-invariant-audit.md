# Invariant re-audit — Codex Phase A env (Human Gate 5.8)

**Date:** 2026-07-16 · **Auditor:** Daniel (hand-run), recorded by boss session
**Invariant (ordering-law 4):** no agent environment holds a `Contents: write` / REST-API /
PR-write GitHub token — git-transport only (SSH deploy key). This is the Codex env's FIRST
invariant check (it did not exist at the 1.10 audit).

## Evidence (run on the desktop box, PowerShell)

```
PS> $env:GITHUB_TOKEN; $env:GH_TOKEN; $env:OPENAI_API_KEY; $env:CODEX_API_KEY
(all four empty)

PS> gh auth status
gh : The term 'gh' is not recognized ...   (GitHub CLI not installed at all)
```

## Result: PASS

- No GitHub REST/PR-write token in the environment; `gh` not installed.
- No `OPENAI_API_KEY`/`CODEX_API_KEY` (metered-billing vectors) in the environment;
  Codex auth is ChatGPT-subscription via Windows Credential Manager
  (`cli_auth_credentials_store = "keyring"`, gate 5.7 — no plaintext `auth.json` on disk).
- Git access provisioned at this gate: repo deploy key `kb codex-worker deploy key (Phase A)`
  (ed25519, write access) + branch ruleset `protect-ops-main-from-workers` targeting
  `main` + `ops` (require-PR, restrict deletions, block force pushes; bypass = repository
  admin only — deploy keys deliberately NOT on the bypass list). Phase A scope: read +
  own-work-branch (`codex/*`) push only; no ops-write path.

## Not yet wired (deliberate, later gates)

- The codex-worker checkout's git remote/ssh-config binding to the deploy key happens at
  runner go-live (gate 5.10), not here.
- Phase B scoped ops-push + re-audit is gate 5.9 and re-checks this same invariant.
