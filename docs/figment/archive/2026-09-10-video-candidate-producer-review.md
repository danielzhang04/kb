# Video candidate producer review

Reviewed the candidate-producer delta against
`2026-09-10-video-acceptance-plan.md` (`07649a8b625ea00917c93d076b43f33e634772d2b7c08eb91303779586f327e3`).

## Verdict

READY for the bounded producer/evidence slice. This is not acceptance authority.
The candidate manifest is explicitly `unreviewed` and eligible only for a future
temporal review; assembly remains `not_promotable` evidence and writes no
accepted-video record.

## Reviewed behavior

- `review-candidate-v1` accepts only the current approved-gen route, requires
  `native-1280x704`, uses a distinct schema and reserved output/candidate ID,
  and preserves diagnostic defaults.
- The candidate persona must be the plan-bound current persona by relative path
  and raw SHA-256. Candidate preflight bounds and depth-checks grade evidence
  before calling the still authority, rejects reparse paths, rechecks dependency
  snapshots, and replays compilation immediately before the fresh manifest write.
- The compiler’s candidate graph digest matches the unchanged harness
  `apply_job` graph, including SaveImage node 9's candidate output prefix. The
  real approved-gen test also proves upload expansion and a provider-free 81-file
  native harness dry-run.
- Candidate assembly accepts only the exact candidate state, reserved namespace,
  and native 1280x704 budget; its local 81-frame fixture records a candidate MP4
  and non-authoritative receipt. Diagnostic 512x288 assembly remains separate.
- Two static JSON inputs retain their existing raw pins through scoped LF checkout
  attributes: workflow `d1020d3af19df2b8875c024b792451699b103140211da2b6359306658feac2f2`,
  model inventory `fa7d6e5c900d963031c04ca4dfeab2ee1c955d960dcea9abd5f5224ab17a6f68`.

## Repair history

The review found and the author repaired: an unbound same-ID persona path;
mutation between initial persona read and authority validation; missing final
dependency replay; parsing deeply nested candidate evidence before its depth
guard; unbounded growth during snapshot reads; and a diagnostic-sized candidate
assembly fixture. The final snapshot reader limits reads to the cap plus one
byte and checks depth before `json.loads`.

## Verification

```text
C:/Users/danie/AppData/Local/Programs/Python/Python313/python.exe -I -B -m pytest orgs/figment/pipeline/video/tests -q --basetemp C:/Users/danie/kb/_private/video-candidate-review-pytest-native
# 61 passed in 40.37s

C:/Users/danie/AppData/Local/Programs/Python/Python313/python.exe -I -B -m pytest orgs/figment/pipeline/tests/test_gen_stage.py::test_real_approved_gen_lineage_compiles_nonpromotable_video_and_rejects_stale_evidence -q --basetemp C:/Users/danie/kb/_private/video-candidate-real-join-review-pytest-native
# 1 passed in 30.79s
```

Root independently reproduced the former 20,007-byte/10,000-depth failure and
verified its fail-closed repair in
`_private/figment-video-candidate-snapshot-probe-20260910-v2/result.json`.
Root also verified the two scoped checkout filters in
`_private/figment-video-checkout-filter-proof-20260910-v1/result.json`.

## Final byte pins

| File | SHA-256 |
| --- | --- |
| `.gitattributes` | `047c07f93b78f36f1b1337ec1a21b3f9700edf44c6d93281f89a8cdf324c0d37` |
| `video_manifest.py` | `da84437336f1568cd01cb812d7626ee2e67203ba1817ba97f5c4f82c39077eb3` |
| `frame_assemble.py` | `a6282ad4383643212df85166cc73a5823d37f8f0a0f0deebe6958abef3d47551` |
| `test_video_manifest.py` | `b84c68e07be43e1ac27cd1330d72038abe98d782c4e4ae367e8654370227d3aa` |
| `test_frame_assemble.py` | `7fa8acef4b7b604bb79d34799839190ce632a42226b62aca2fea690cc92024d1` |
| `test_gen_stage.py` | `d47f039ad8512f18241751209ebb134fb615a4e714b4828a58182a1e6b938619` |

Limit: no provider was invoked, no clip was accepted or judged, and future
temporal review must independently derive the current graph and validate the
full current evidence chain.
