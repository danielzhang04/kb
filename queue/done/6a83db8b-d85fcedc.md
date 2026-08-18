---
id: 6a83db8b-d85fcedc
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\gate1-collector-port
risk-tier: T1
owner: codex-worker
claim-token: 8da47b3367a3e1fe
state: done
approval: null
workflow: 01a0130f-00ab-7cf0-8bdf-d1712ebf5df4
depends-on: []
variant-group: null
role: work
session-id: 6a83dadb-ea106764
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Task: Gate-1 collector probes must not send an explicit default port. NO git write commands.

Work ONLY in `C:/Users/danie/kb-worktrees/gate1-collector-port` (your cwd; branch from origin/main
@ ae4dad03). Files: scripts/gates/phase1_gate1.py + tests/test_phase1_gate1.py. Minimal diff.

\## Live defect (reproduced on the production VM)
`normalize_base_url` (line ~337) returns `https://<host>:443`; urllib then sends
`Host: <host>:443`; the daemon's origin guard authority is `new URL(origin).host`, which strips
default ports — mismatch → every guarded probe 403 `host-not-allowed` → the gate can never PASS
against its own origin guard. Verified: `https://kb...ts.net/api/index` → 401 (correct);
`https://kb...ts.net:443/api/index` → 403 host-not-allowed.

\## Work order
1. Change `normalize_base_url` to OMIT the port when it equals the scheme default (443/https,
   80/http), keeping it for non-default ports. Keep all existing rejection rules. Do NOT change
   `normalize_external_serve_endpoint` (the `:443` canonical form is the documented contract for
   the ACL/serve comparisons and the plan pins it).
2. Audit every probe-URL construction in the collector for other places an explicit default port
   could leak into a request (incl. the WebSocket authority derivation — check
   `websocket_request_bytes` callers: what authority string is passed, and does the raw WS
   handshake carry `:443`? If yes, same fix there: default port stripped from the Host/authority
   actually sent, non-default kept). Fix any found; report each site.
3. Tests, matching existing style: normalize_base_url("https://h") == "https://h" (no port);
   ("https://h:443") == "https://h"; ("https://h:8443") keeps 8443; http/80 analog; and a probe-URL
   assertion showing the request URL passed to the opener carries no `:443`. WS authority test if
   step 2 changed it. Confirm the key tests fail against the old normalization (state how).
4. Run `py -3 -m pytest tests/test_phase1_gate1.py -q --basetemp=./.pytest-local-tmp`; report numbers.

Terse final report: sites changed, test numbers, anomalies.

## Result

Changed sites:

- `normalize_base_url`: strips scheme-default ports; keeps non-defaults.
- Collector HTTP/WS URL construction now sends no `:443`.
- WebSocket raw handshake authority now strips only its scheme’s default port.
- Confinement comparison probe-normalizes the preserved Serve canonical `:443`; `normalize_external_serve_endpoint` unchanged.

Tests: `46 passed in 1.89s`  
Command: `py -3 -m pytest tests/test_phase1_gate1.py -q --basetemp=./.pytest-local-tmp`

Old behavior would fail 4 default-port normalization cases, the opener/collector URL assertions, and the `wss://…:443` Host-header test (`Host: h:443`). No remaining default-port request leaks found.
