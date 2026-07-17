# Proposal — an optional `code-server` annex (not the front door)

Status: DRAFT proposal (D3.5). This is proposal text only. It describes an *option*; it changes no
governance. Any governance change (opening a port, adding a dependency, granting an ambient credential)
would be committed by a human editing `governance/` — this document only lays out the shape and the
guardrails so that decision can be made deliberately.

## Problem

Mission Control is a read-only observatory plus a narrow, WebAuthn-gated write surface (save / launch /
stop, approvals). It deliberately does **not** offer a general editing or shell surface. Occasionally an
operator wants a full editor / terminal against the repo checkout — today that means leaving the
dashboard for a local VS Code / terminal. The question is whether a browser-reachable
[`code-server`](https://github.com/coder/code-server) (VS Code in the browser) belongs *alongside* the
dashboard as an **annex**.

## Proposal in one line

Offer `code-server` as an **optional, off-by-default, loopback-only annex** reached from the Sentinel
layer — never as the dashboard's front door, and never in the request path of any governed write.

## Non-goals (hard boundaries)

- **Not the front door.** The dashboard daemon stays the primary surface. `code-server` is a *link out*,
  not an embed that governed flows route through. Nothing in the approvals / launch / stop path may
  depend on it being up.
- **Not a governance bypass.** `code-server` gives shell + file write. That is strictly more power than
  the dashboard's governed write surface. It therefore must **not** inherit the dashboard's session, and
  it must **not** be presented as an equivalent "just edit here" shortcut around the card queue. Writes
  made through the annex are ordinary developer edits on a branch — they are *not* coordination writes and
  must not touch `ops/` state, ledgers, or the queue except through the normal card flow.
- **Not always-on.** Default is *not installed / not running*. It exists only when a human has explicitly
  turned it on for a session.

## Shape (if adopted)

1. **Bind loopback only.** `code-server --bind-addr 127.0.0.1:<port>`, same trust posture as the daemon
   (`HOST = 127.0.0.1`). Network location is never a trust boundary; loopback is the containment.
2. **Its own auth.** `code-server`'s own password / cookie, held outside the repo. The dashboard does not
   mint, forward, or store it. No ambient credential is printed, copied, or persisted by the dashboard to
   enable the annex.
3. **Discovery, not embedding.** The Sentinel layer shows an annex *status* row (up / down + the local
   URL) and a link that opens `code-server` in a new tab. No `<iframe>` embed, so the annex can never sit
   silently in a governed flow's DOM.
4. **Off by default, human-gated.** A `governance/`-level flag (human-edited) enables the status row.
   Absent the flag, the dashboard shows nothing and assumes the annex does not exist.
5. **Audit note.** If adopted, a one-line note in the audit log when the annex link is opened keeps the
   "who reached for the powerful tool, when" trail — the annex itself stays outside the governed surface,
   but the *reach* is observable.

## Guardrails summary

| Concern | Guardrail |
| --- | --- |
| Escalation past the governed write surface | Separate auth; annex writes are branch edits, never coordination writes |
| Accidental exposure | Loopback bind only; off by default; human-gated flag in `governance/` |
| Front-door creep | Link-out only (new tab), never an iframe/embed; no governed flow depends on it |
| Credential handling | Dashboard never creates/reads/stores the annex credential (constitution's hard ceiling) |

## Decision requested

None here. This is a written option for Daniel to weigh. Turning it on is a governance edit (a human
commit under `governance/`) plus the operational step of running `code-server` — both out of scope for
any agent. This document exists so that, if the annex is ever wanted, its boundaries were reasoned about
*before* a port was opened, not after.
