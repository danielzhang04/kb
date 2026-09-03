---
schema-version: 1
id: 6a99c27a-fb54eccb
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p2
risk-tier: T1
owner: codex-worker
claim-token: 19f7da7448a5f7c3
state: done
approval: null
workflow: 01a06896-4e09-75f3-8253-062671812b01
depends-on: []
variant-group: null
role: work
session-id: 6a99c00c-8eed6ba9
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 16bec2a5a819b7baff88944623604e630e26edff
---

## Work order

You are a codex BUILDER in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p2`
(branch `claude/prospecting-p2`). Run `python scripts/preamble.py` once (expect PREAMBLE OK; if no
output within 60 s, retry once, then proceed and note it). NEVER commit, never touch git refs, never
pip install, never run repo-wide grep, never read memory/, queue/, ledgers/, orgs/faceless-youtube/,
dashboard/. Use `--basetemp .pytest-tmp-t11 -p no:cacheprovider`. Sandbox may lack Datasette/Playwright
(host has them). Stop at 40 minutes. First edit by command 6.

\# Build brief — P2 Task 11 (REPLACES the plan's Task 11; boss ruling)
Agent declarations, skills and eval cards are P5 work (agents come last). P2 Task 11 = the P2 gate
manifest + gate run only, in the FLAT schema the runner defines (`gate_manifest_p2.json` already exists
as a skeleton with 3 tests). Read `py -3 -m scripts.prospecting.gate --help`, `scripts/prospecting/gate_manifest_p3.json`
(a complete example), and spec "### P2" numeric criteria.

\## Task
1. Fill `scripts/prospecting/gate_manifest_p2.json`: `artifacts` = every P2 file (`git ls-files` under
   `scripts/prospecting/` for: lanes/, providers/, finder_*.py, capture.py, finder_base.py, bakeoff.py,
   browser_guard.py, linkedin_lane.py, linkedin_parsers.py, scorer.py, fetcher.py, list_builder.py,
   p2_schema.py, p2_p1_contract.py, the P2 test files, and `orgs/prospecting/fixtures/` P2 fixtures incl.
   `vendor/**`, `finder-pages.json`, `bakeoff-50.json`, `linkedin-checkpoint.html`) + the manifest file itself;
   `fixtures` = the P2 fixture file names; `tests` = ALL collected nodes under `scripts/prospecting/tests/`
   (sorted); `criteria` = built-ins (failures/skips/xfails/warnings/external_network_calls/
   child_processes_without_guard = 0, `minimum_enumerated_tests` = count, `inspector_minimum` = 90) plus the
   spec §P2 custom measures as `record_property` sums recorded by EXISTING tests (e.g. `synthetic_companies_run`
   (30), `credit_overage_rejections`, `lane_cap_violations` (0 measured as a positive assertion count),
   `pii_sink_rejections`, `cookie_inputs_rejected`) — add `record_property` calls to the tests that already
   prove each fact; no vacuous tests. `artifact_hashes` via `scripts.prospecting.gate.compute_artifact_hashes`
   (manifest excluded). Add `test_capability_surface.py` (already created by the previous attempt) to the
   lists if it is a real test; delete it if it is a stub.
2. Run `py -3 -m scripts.prospecting.gate --phase P2 --inspector-score 90` and paste the JSON (Datasette/
   Playwright-dependent nodes may fail in your sandbox — say so; the boss re-runs on the host).
Report: files changed, the criteria table, the JSON.

## Result

Implemented the flat P2 manifest: 43 artifacts, 14 fixtures, and 219 sorted collected nodes. Updated metric-bearing P2 tests; the retained capability-surface test now targets the flat schema.

Changed: [gate_manifest_p2.json](C:\Users\danie\kb-worktrees\prospecting-p2\scripts\prospecting\gate_manifest_p2.json), plus P2 test files for bakeoff, browser guard, finder lanes, list builder, provider budget, and [capability surface](C:\Users\danie\kb-worktrees\prospecting-p2\scripts\prospecting\tests\test_capability_surface.py).

| Criterion | Required |
|---|---:|
| Enumerated tests / inspector | 219 / 90 |
| Failures, skips, xfails, warnings | 0 |
| External network / unguarded children | 0 |
| Synthetic companies / predicate types | 30 / 10 |
| Approximation rejections / lane-cap assertions | 5 / 1 |
| LinkedIn loads / delay bounds / session cap | 40 / 2 / 1 |
| Restart, checkpoint, credit reservation assertions | 1 / 1 / 1 |
| Credit overage / reservation settlement | 1 / 1 |
| Job-change stale contacts / conflicting-observation assertions | 2 / 1 |
| Bakeoff attempts per adapter | 50 |
| PII sink combinations / cookie-input rejections | 112 / 1 |

Verification: the seven P2-owned implementation test files pass: `98 passed in 7.60s`.

The requested gate is fail-closed in this sandbox because Git index writes are denied (the pre-existing capability test remains untracked) and the pinned Datasette runtime is unavailable. The P2 prerequisite also sees existing P1-record hash differences in `store.py` and `test_pii_guard.py`; I left those unrelated changes untouched.

```json
{"artifact_hashes":{"orgs/prospecting/fixtures/bakeoff-50.json":"262818574d81a23cd17d273883c7c05716eda53d88667d911abd9d2957d75121","orgs/prospecting/fixtures/conflicting-providers.json":"7e68a9b14a4955529cd313fec63cae164b7b9f5de6605a41b0c7c9b61fa2ea82","orgs/prospecting/fixtures/finder-pages.json":"9b8fcdbd0a17c82cd3b3a6174b61aafffabef90b6f4d36b2c9f1679ede2e1db0","orgs/prospecting/fixtures/job-change.json":"a94c1b278650993fc1183cd7a08a3be81ffd5124f2f7ca762a56c5b04576ed82","orgs/prospecting/fixtures/linkedin-checkpoint.html":"4317378eb6bff5ebffa5c7c8fab146f8cdebd872030b9efd826bf84f7ae59565","orgs/prospecting/fixtures/snapshot-injection.html":"af7ade42813b2a04e678a30c1dc7f0e72df3eb030e54ade2634777660e8c1044","orgs/prospecting/fixtures/vendor/apify/profile-error.json":"fb19e470ca08e7c991b50f1a3ad124c964060623d1fcf4cebe24f8a03f028f41","orgs/prospecting/fixtures/vendor/apify/profile-success.json":"1164b4a90f8cbd0dcdedfcd51856409a7f557b7cf61210a1daa0f036c911a37b","orgs/prospecting/fixtures/vendor/hunter/find.json":"7ce9d0f7cae02a296e093f84ddbbf2935f55b3323fe9c9402713ee0d724e7a7c","orgs/prospecting/fixtures/vendor/hunter/verify.json":"449d0fcaf1018eeb27498c4e390f8c5954d4944331fd5aa5dba719c20a8c0f52","orgs/prospecting/fixtures/vendor/pdl/spot-not-found.json":"b61d60fa9dfe1713e8c972e334dae2d5a8917e4ea6d8f9f7829e49651a3d7a68","orgs/prospecting/fixtures/vendor/pdl/spot-success.json":"b150554b9f782a61d5210d2cc3c47650afaea8c4d041281fd2f4e27f6525d39a","orgs/prospecting/fixtures/vendor/snov/find.json":"7ce9d0f7cae02a296e093f84ddbbf2935f55b3323fe9c9402713ee0d724e7a7c","orgs/prospecting/fixtures/vendor/snov/verify.json":"449d0fcaf1018eeb27498c4e390f8c5954d4944331fd5aa5dba719c20a8c0f52","scripts/prospecting/bakeoff.py":"3271ee90cafee5c76acaae131e0edc04d1ad7880d6bdd574a77578aed45d97fd","scripts/prospecting/browser_guard.py":"8e2e66d4d133a2992ffb83144a9d46af5f86d2340ea9d820243bc6c37162abdf","scripts/prospecting/capture.py":"ac5833549c7a37f3d7ecc022da4a533ffea8448791ca75dea5361f044ef9fe0b","scripts/prospecting/fetcher.py":"42989b36543ac6e06925638b077a126d3633c89c18bdd660a6f7d64eca7e5466","scripts/prospecting/finder_apify_public.py":"1b0a4bc00da672aa4bae7b7997bf97cd75c10d8433a4350c19125c1a84244fe8","scripts/prospecting/finder_base.py":"3a992831e7cb1034cafd82711947f5e8b320bdce1e8c4cb74a4351a601241796","scripts/prospecting/finder_linkedin.py":"afb3b4f46a59c1199a28e6cc5fe16508fec84de4f8f34798af08e8067300951f","scripts/prospecting/finder_manual.py":"9a281fc1fa36022e519ea9096fb4df0ee576e3c559b471dcc96cb548a8814344","scripts/prospecting/finder_pdl.py":"8bb4bc31aef9b15b27dc0df52fed10c82132bf203df781dc86f79a9b60292fa3","scripts/prospecting/finder_pitchbook.py":"59d4af9267e878f57de109209a7bf5ec29e7c3baebaf4357bd17f930d46a6259","scripts/prospecting/lanes/__init__.py":"1b0a4bc00da672aa4bae7b7997bf97cd75c10d8433a4350c19125c1a84244fe8","scripts/prospecting/linkedin_lane.py":"fc4926af0e09c39b93265bcdad1a1eeebd5534629b38fe70366c6c40162c9132","scripts/prospecting/linkedin_parsers.py":"cf9f95cccb66e22594c8fc45ac209d39c496f05767961b5d4bee147041e067de","scripts/prospecting/list_builder.py":"789669c9186605a0fc34adc864af357b905de3ede21cb929ec4899949714c7d0","scripts/prospecting/p2_p1_contract.py":"c71bc8381bc834916a5208d87dcf64394d8112a07bc5b2641c482abebbac69e9","scripts/prospecting/p2_schema.py":"114384e70dcb2a1aaed54826bfbd007a988dee175069c940906b410a3ef32510","scripts/prospecting/providers/base.py":"5a6e8137ac5b3c4e6918d5c5f6ee29fae31c1458b3cb32acd8a91f3821defb23","scripts/prospecting/providers/hunter.py":"dbb0a9327c5c42fd42215463f49b9240a1e46c9106d48cecd2170acb8025dcb2","scripts/prospecting/providers/snov.py":"aa2921f9aa8b74228af90a9f1ce4a79c47431b0968ec94ae6878b442463c51d5","scripts/prospecting/scorer.py":"b161bdfc7f3e1b342f54b7286b87701fed42ee643ad1debdc6e2f58b912c6b54","scripts/prospecting/tests/test_bakeoff.py":"6eb4baa7baf62e1d63f634a56677790862e8905d8352acb392e782938778e0ac","scripts/prospecting/tests/test_browser_guard.py":"9994320bd79dc0cf8aaa12898ff07027afa85be006c0f5c847241268a7da50a5","scripts/prospecting/tests/test_capability_surface.py":"a4a09a05a30ea371fbf9f5e98092b5ab624cc135c5343a22fbc8e599c9f4e9de","scripts/prospecting/tests/test_fetcher.py":"5ca4e17666c947335c046c6b413828a7b85fa49c50f8e3784e67a1cdb37b16b1","scripts/prospecting/tests/test_finder_lanes.py":"7108ed0c347a5f1541d842ef90c962a55a3e8dc11fb536f4f5bd39769c20047a","scripts/prospecting/tests/test_list_builder.py":"b590d765ddeed3792f68654b1cc179f535dc9374d730bd9a0d958d1c0d50f374","scripts/prospecting/tests/test_p2_prerequisite.py":"29d5291724ade16b8b084c67ec7e846febb6cca1a1d1eec7e8eed737483e1c5e","scripts/prospecting/tests/test_provider_budget.py":"b452cd74039a49a3862bc224d5283615a6a494eacb2a1a829368dfff8e355315"},"child_processes_without_guard":0,"error_codes":["gate_1","gate_2"],"errors":["untracked artifact: scripts/prospecting/tests/test_capability_surface.py","runtime prerequisite mismatch"],"external_network_calls":0,"failed":1,"failed_nodes":[],"inspector_score":90,"interpreter_path_sha256":"","passed":0,"phase":"P2","skipped":0,"status":"failed","warnings":0,"xfailed":0}
```
