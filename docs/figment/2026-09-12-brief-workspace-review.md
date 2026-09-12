# Research brief revision composition acceptance

The Research panel now mounts the accepted local brief revision form and uses the Workspace's existing inventory request. Only recorded `creator-001` briefs are offered as bases. Submission creates a local planning revision; the inventory refreshes only after the separate **Refresh recorded briefs** action. The header distinguishes project evidence and local planning from checkpoint approval.

Root reviewed the source and tests, and an independent source review found no material issue. The composition changes only `FigmentWorkspace.tsx` and its test. It adds no second inventory-request owner, backend route, authentication exception or automatic POST. Research's unavailable, empty and indexed views expose the form; the article-reader view retains its existing focused behavior.

Accepted inputs:

- `dashboard/src/figment/FigmentWorkspace.tsx`: `24cd5495b039a2c7d8ce59d2a06ccdd7f67edbf86e51a338e6c6663b3bdfa530`.
- `dashboard/src/figment/FigmentWorkspace.test.tsx`: `11cf3f8aa71d547e57662854d10c3753f2701151f41ca88ab7f62113c41801e9`.
- The governed write surface was accepted at `a3ab95ef`; the isolated form and decoder at `8218350f`. Their contracts and verification remain separate from this composition acceptance.

## Verification

The first focused invocation in `MAIN/_private/figment-brief-workspace-verification-20260912-v1` exited `1` after the default Vitest forks worker failed to start. Zero tests ran. That infrastructure failure remains preserved and is not a product-test failure. The unaffected TypeScript no-emit check completed at native exit `0` from 10:00:02.092 to 10:00:23.747 UTC, and Vite build completed at native exit `0` from 10:00:33.983 to 10:00:35.949 UTC. The original stop-state receipt is preserved beside the corrected receipt that includes those completed checks.

Installed Vitest 4.1.10 supports the threads pool; the inspected Workspace runtime import graph contains React, local UI and shared decoders, with no native-addon imports. One separately authorized `--pool=threads` invocation ran from 22:06:03.519 to 22:06:47.352 UTC, native exit `0`, with **41/41 passing cases**, no failures or skips, and empty stderr. No source, assertion or project configuration changed, and the forks path was not retried. Typecheck/build were not repeated.

The four new cases verify creator-001 base filtering; no POST on mount, navigation or parent retry; success remaining local until an explicit current-token inventory refresh; and suppression of a pending old-token completion without a POST under the replacement token. Root parsed the actual case report and checked the named live hashes. All 20 finite before/after inputs matched. This is not a transitive dependency closure.

Threads evidence is `MAIN/_private/figment-brief-workspace-verification-20260912-v2-threads`; raw reporter SHA is `3052124ca670499d640f439ff4df06f57bd9d78f05fac9c08bfeeef42f883e83`. Commands, timestamps, native exits, actual cases and pin comparisons are retained.

## Browser acceptance

One prepared Chrome/CDP driver ran from 22:10:17.786 to 22:10:23.198 UTC, native exit `0`, at a 1440 × 1200 desktop viewport. Root actually viewed all four PNGs and accepted readable labels, inputs, controls and results, with no observed clipping or horizontal overflow:

- Initial form with one recorded base: `01-initial-form.png`, SHA `fe7ab74639f099417aeb349ca7832ee8a512cecf1be974e82218d886bd56ca62`.
- Successful local planning result: `02-success.png`, SHA `a4146cc7f48c4c9e6eb32e86fa8edcd5b4d2a285072eb0a34ad0337c768ccf94`.
- Explicit refresh showing two brief cards: `03-explicit-refresh.png`, SHA `376b6c7ecbbd4be4376fb67daec98ef8b74aed2751c3a632207da277c1ae7558`.
- Clear ambiguous outcome with no repeat-submit control: `04-ambiguous.png`, SHA `667f3b21232a16d531147920b21420042c363ef39b139433ae6ff8359801f8dc`.

The strict synthetic mock allowed only authenticated inventory GET and revision POST, checked the exact five-field body, and rejected other application requests. The driver verified two initial React development StrictMode GETs, exactly one POST, no automatic refresh, then one additional GET after explicit refresh. A separate synthetic 503 scenario showed fixed ambiguity copy, no private detail and no repeat POST. Root independently checked all 28 fresh before/after/current named hashes, parsed the successful driver result and checked cleanup records; all matched. The older prepared inventory is retained unchanged and explicitly predates the accepted Workspace composition.

Evidence is `MAIN/_private/figment-brief-ui-visual-verification-20260912-v1`. Chrome retained its sandbox and used a fresh profile; Vite had no proxy and listened only on loopback. Exact recorded Chrome/launcher/server processes were force-stopped, not claimed as normal exits. Neither planned port (64937/9251), owned PID nor either temporary preview file remained. The profile, logs, screenshots, prepared inventory and execution pins remain retained.

This establishes one bounded synthetic desktop journey. It does not establish live authentication/backend publication in a browser, a browser/device matrix, actual media quality, full plan execution and assignment, deployment or external publication. The real brief publication/reader join and governed guard/audit tests supply separate local evidence; they were not rerun here. `MAIN` is `C:/Users/danie/kb`.
