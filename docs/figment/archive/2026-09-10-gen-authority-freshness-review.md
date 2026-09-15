# Gen authority freshness review — 2026-09-10

## Verdict

READY. I found no correctness or security blocker in the final bounded change.
The reviewed source is `figment_train.py` SHA-256
`555cb710a5867b16fa9ea94df3439ac85e4bdbf555f60c31c8dd786e3492326e`;
the shared test file is
`c71e2709513e771ce8a4cfc92634562ded8b866b46b75056c0bc80139375776a`.

## Review result

The gen plan now captures the accepted checkpoint, source plan, approval
lineage, and checkpoint digests after current checkpoint validation. Gen
execution revalidates that authority before stage state is opened and again at
each base/detail launch boundary. A stale persona, training selection, source
plan, approval record, lineage, checkpoint, or staged copy refuses before the
next harness call.

For a two-run gen plan, a change after the completed base run leaves that run
complete, does not create the detail-run attempt, and records
`status: stopped:gen`. Missing source evidence is normalized to
`FigmentTrainError`, so the same stopped-state path applies instead of leaking
an `OSError` and leaving `running:gen`.

I also checked the existing real train-first tester selection into a fresh gen
plan. It continues to stage only the current selected checkpoint and now binds
the new current-authority snapshot.

## Independent evidence

Python 3.13 focused review: 4 passed, 17 deselected in 37.57 seconds. The set
covered the pre-harness mutation matrix, both between-run mutations, and the
real train-first-to-fresh-gen join. JUnit SHA-256:
`878b91218a5ec7dce530256df647349ecdf00bc8be1bfa4e25a3d56002330e6c`.
Evidence is under
`MAIN/_private/figment-gen-authority-review-20260910-v1/`.

The author separately reported three focused passes after the final I/O repair
and an earlier 20-pass full gen-stage run. Those are author evidence, not my
independent run. This review did not call a provider, launch a pod, or change
pipeline state outside isolated test directories.
