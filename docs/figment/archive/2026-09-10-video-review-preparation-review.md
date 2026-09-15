# Video review preparation independent review

Reviewed 2026-09-10. Verdict: **READY** for the narrow prepare-only evidence
step. This is not an accepted-video decision, quality ruling, provider action,
or authority to run a candidate.

## Scope and pins

- `pipeline/video/video_review.py` SHA-256
  `f44d8f4db4018db74957fdbbb4c7d9778f10357c5dad2e2d4fdcc8aa3f50ddff`
- `pipeline/video/tests/test_video_review.py` SHA-256
  `40bda54d1e5d39c6256a824caeb1dfff1317739d43218aae16928ca6fd1d7a35`
- shared real gen-to-prepare join in `pipeline/tests/test_gen_stage.py`
  SHA-256 `c71e2709513e771ce8a4cfc92634562ded8b866b46b75056c0bc80139375776a`
- contract plan `docs/figment/2026-09-10-video-acceptance-plan.md` SHA-256
  `8388668c61aa6340ac7b1b6770b9c68e95eee1e190f9cbd0c6d19e6b4a70c8bb`

## Findings

No actionable findings. The implementation rebuilds the candidate through the
existing current approved-still validator before accepting it as review input.
It rejects diagnostic mode, rereads bounded regular JSON under the supplied
root, binds the run, assembly and extraction records to current bytes, and
checks all 81 ordered PNG prompt graphs against the effective job graph with
only the pinned LoadImage fingerprint annotation. It rechecks the complete
subject before creating its fresh, candidate-keyed evaluation record and
removes an owned partial directory on failure.

The stored record is `prepared` evidence only. It contains no ruling writer,
accepted lifecycle, quality decision, provider call, or expanded media export.
Later temporal acceptance remains outside this reviewed scope.

## Verification

```text
C:/Users/danie/AppData/Local/Programs/Python/Python313/python.exe -I -B -m pytest orgs/figment/pipeline/video/tests -q --basetemp C:/Users/danie/kb/_private/figment-video-review-test-v1
74 passed in 145.75s

C:/Users/danie/AppData/Local/Programs/Python/Python313/python.exe -I -B -m pytest orgs/figment/pipeline/tests/test_gen_stage.py::test_real_approved_gen_lineage_compiles_nonpromotable_video_and_rejects_stale_evidence -q --basetemp C:/Users/danie/kb/_private/figment-video-review-gen-join-v1
1 passed in 45.64s
```

Independent JUnit/XML and text logs are retained at
`C:/Users/danie/kb/_private/figment-video-review-independent-20260910-v1/`:
`video-tests.xml` SHA-256
`12bdc3c9e910eb32d0f86c57086d33ac2a5e6751783849413369ce76b229bad9` and
`gen-prepare-join.xml` SHA-256
`7c3aa8e29a2962f223d84710ed66e6a7960a83fccede05c373a4c56b5c56302c`.

The second fixture uses a current approved-gen chain, constructs the native
81-frame candidate receipt, runs assembly and extraction, and invokes the
prepare CLI through a subprocess. These are local synthetic fixture records;
they do not provide a real candidate, review ruling, or production acceptance.
