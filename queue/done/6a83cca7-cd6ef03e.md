---
id: 6a83cca7-cd6ef03e
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\gate1-webauthn-channel
risk-tier: T1
owner: codex-worker
claim-token: e1885b3dcb96c081
state: done
approval: null
workflow: 01a012d2-3b7b-71d1-a195-c292312652d4
depends-on: []
variant-group: null
role: work
session-id: 6a83cb4d-4be88e71
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Task: Sanctioned DASHBOARD_WEBAUTHN_CREDENTIALS channel in the VM validator + bootstrap. NO git write commands.

Work ONLY in `C:/Users/danie/kb-worktrees/gate1-webauthn-channel` (your cwd; branch from origin/main
@ e642a9a3). No git write commands; read-only git fine. Minimal diff. Mirror the RP_ORIGIN
sanctioned-channel precedent from PR #122 exactly (read its changes: `git log --oneline --grep=rp-origin`,
`git show <sha>` for deploy/bootstrap_vm.py and deploy/validate_vm_runtime.py).

\## Context (live contradiction found during Gate-1)
The daemon resolves registered passkeys ONLY from `DASHBOARD_WEBAUTHN_CREDENTIALS` in its unit env
(dashboard/server/auth/credentialStore.ts resolveCredentials — JSON array of
{id: base64url, publicKey: base64url COSE, counter?: number, transports?: string[]}). But
deploy/validate_vm_runtime.py forbids it: the name matches CREDENTIAL_ENV_NAME (/CREDENTIAL/i), and
EXPECTED_UNIT_ENV/OPTIONAL_UNIT_ENV close the assignment set (only DASHBOARD_RP_ORIGIN optional).
Result: no session can ever be minted on the VM. Ruling (Daniel, 2026-08-17): admit this ONE var as
sanctioned config — it carries PUBLIC-key verification material (an allowlist), not a secret — with
strict shape validation preserving the guard's intent.

\## Work order
1. `deploy/validate_vm_runtime.py`:
   - Add `DASHBOARD_WEBAUTHN_CREDENTIALS` to `OPTIONAL_UNIT_ENV`.
   - Exempt exactly this one name from the CREDENTIAL_ENV_NAME rejection in BOTH the static unit
     check (~line 107) and `validate_environment` (~line 22) — via an explicit
     `SANCTIONED_PUBLIC_KEY_ENV = frozenset({"DASHBOARD_WEBAUTHN_CREDENTIALS"})` constant with a
     comment stating WHY (public verification material, shape-validated below), not by weakening the
     regex.
   - When the var IS assigned in the unit, validate its VALUE strictly (like RP_ORIGIN_PATTERN does):
     parses as JSON array; 1..8 entries; each entry an object with ONLY keys id/publicKey/counter/
     transports; id and publicKey base64url-charset strings (id 16..1024 chars, publicKey 32..4096);
     counter (if present) a non-negative integer; transports (if present) an array of short strings.
     Any violation -> RuntimeError naming the defect. This shape can hold no usable secret.
2. `deploy/bootstrap_vm.py`: add `--webauthn-credentials` (optional) mirroring `--rp-origin` exactly —
   same unit-write mechanism, same idempotency semantics. Validate the value with the SAME shape
   check before writing (import/share the validator function rather than duplicating it).
3. Tests, matching existing style, in tests/test_validate_vm_runtime.py and tests/test_bootstrap_vm.py:
   - unit assigning a valid credentials array passes static validation; all other credential-named
     vars still rejected (e.g. DASHBOARD_SESSION_SECRET, MY_TOKEN);
   - malformed values rejected: non-JSON, non-array, extra keys, non-base64url charset, oversize,
     secret-looking entry (e.g. a key named "privateKey") — pick representative cases;
   - bootstrap --webauthn-credentials writes the unit assignment; invalid value refuses before any
     write; omitted flag leaves unit unchanged;
   - validate_environment still rejects other credential names but passes this one.
4. Run `py -3 -m pytest tests/test_validate_vm_runtime.py tests/test_bootstrap_vm.py -q --basetemp=./.pytest-local-tmp`;
   report numbers. Confirm key new tests fail against pre-change code (state how).
5. Touch ONLY those four files. No dashboard/ changes.

\## Acceptance
Minimal diff, precedent-shaped, shape-validation shared not duplicated, terse report with numbers.

## Result

Implemented the sanctioned public-key channel in only the requested four files.

- Added shared strict JSON shape validation and the explicit sanctioned-env exception.
- Added `--webauthn-credentials`; generated unit safely quotes the JSON and remains byte-identical when optional flags are omitted.
- Added static/env/bootstrap coverage, including malformed and secret-looking inputs.

Verification: `73 passed in 1.27s`  
`git diff --check` passes.

Pre-change confirmation: at `e642a9a3`, the validator rejects `DASHBOARD_WEBAUTHN_CREDENTIALS` as a credential channel, and bootstrap has neither the flag nor parameter.
