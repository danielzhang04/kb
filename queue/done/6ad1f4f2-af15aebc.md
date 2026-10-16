---
schema-version: 1
id: 6ad1f4f2-af15aebc
project: kb-ops
action: nyu-rehearsal-review
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: c374b3dbd441c2d0
state: done
approval: null
workflow: 01a14421-cc5f-79c1-97aa-975b7d600fa6
depends-on: []
variant-group: null
role: work
session-id: 6ad1f429-3ec1cd88
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

Read-only independent review. Follow KB preamble and governance. Review ONLY C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py and the following selected cleanup reports if needed: reports/home-nyu-rebuild-inputs.json, reports/home-nyu-installed-pins-validation.json, reports/home-nyu-base-interpreters-4e1f99e4c4f64a969aa57475701aaded.json, reports/home-nyu-data-mgmt-installed-pins.txt, reports/home-nyu-software-eng-installed-pins.txt (relative to cleanup root). No original project payloads, credential files, private logs, recovery payloads/manifests, architecture documents or other reports. Do not modify files or execute the rehearsal. Pure --self-test is permitted.

Purpose: isolated Windows Python 3.12.8 candidate environment trial before moving home NYU. Original projects and environments remain untouched. Local exact package name/version metadata only, fresh retained fixture, public wheel-only PyPI downloads, no ambient user pip config/keyring/proxy credentials, no global upgrades. User authorizes ordinary-user cleanup/testing, forbids admin and deletion. Script authored by native Claude; root self-test passed 63 checks. Grade ACCEPT or BLOCK with concrete material findings and exact lines. Assess whether intended execution is safe and useful, package/environment containment, unchanged source inputs, honest pass criteria, timeout behavior, subprocess invocation. Note root observed process assignment to job occurs after Popen (possible early child race); assess proportional practical consequence for this known fixed command set, not generic hostile-command guarantees. Do not demand new frameworks or unrelated tests. Explain limitations separately from blockers. Return concise review. Do not publish source payloads or commit.

## Result

ACCEPT — no material findings or blockers.

The intended execution is proportionately safe and useful:

- Requires ordinary-user, isolated Python 3.12.8 and rejects admin execution ([script:402](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:402)).
- Validates pin syntax, counts, hashes, and report consistency before creating anything ([script:139](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:139), [script:171](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:171)).
- Creates a fresh, uniquely named retained fixture without overwrite or deletion ([script:413](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:413)).
- Uses a replacement child environment that excludes ambient pip configuration, keyring and proxy credentials ([script:231](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:231)).
- Uses argument arrays with `shell=False`; installation targets the candidate interpreter, permits wheels only, disables dependency resolution, and fixes PyPI as the index ([script:245](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:245), [script:319](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:319)).
- Accepts only after `pip check`, interpreter containment, an exact installed-distribution comparison, and smoke imports succeed for both courses ([script:386](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:386), [script:397](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:397), [script:475](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:475)).
- Rechecks the five inputs and script after execution; any change invalidates a passing result ([script:487](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:487)).

Limitations, not blockers:

- Process assignment occurs after `Popen` ([script:319](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:319), [script:324](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:324)). A child spawned in that narrow interval could escape job termination. For these fixed local CPython/venv/pip commands and constrained inputs, the practical risk is low; this is not hostile-command containment.
- The 3600-second overall deadline is soft: termination is followed by a wait of up to ten seconds before reporting ([script:304](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:304), [script:331](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:331), [script:343](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:343)).
- The result proves present wheel availability, dependency consistency, and limited imports—not reproducibility or course-runtime correctness. The report states this honestly ([script:58](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/rehearse-home-nyu-environments.py:58)).

Verification: permitted `--self-test` passed all 63 checks with exit code 0. SHA-256 comparison confirmed zero changes across the six authorized files. The rehearsal and network access were not executed. No other cleanup files or payloads were inspected.
