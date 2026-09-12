# Prepared generation status collector acceptance

The standalone `collectPreparedGenStatus` collector is accepted. It binds a server-owned published directory and marker plan digest to one creator-001 gen plan, its manifest and recorded stage/receipt metadata. It reports missing stage history as unknown, running as recorded with unknown liveness, and only internally agreeing terminal metadata as recorded completion or failure. Quality is always `not-assessed`.

This slice adds no route, UI control, execution runner, current source-authority check, ledger validation, provider query or media-byte inspection. The existing train-first collector remains unchanged. Future Studio wiring must validate the published marker and preserve the distinction between recorded status and current authority.

Root and an independent reviewer accepted the source and tests. Independent review: `MAIN/_private/figment-prepared-gen-collector-independent-review-20260912.md`, SHA `85d4a78a3dbd4cef65ef02e7d994342e1711c2801bea4cef56f1e9b990c81250`.

- `dashboard/server/figment/cloudExperiment.ts`: SHA `b2f325446ae144a6facd9ace278145256a7bd794de27b3e8ba90a4d16830d3f1`.
- `dashboard/server/figment/cloudExperiment.test.ts`: SHA `492e866ae1a570a0e18782b9a175375c312677168469ff5c1db8404c5f7ae962`.

One focused Vitest threads-pool run completed at native exit `0` from 22:22:14.535 to 22:22:16.368 UTC on September 12: **47/47 passed**, comprising 30 new prepared-gen cases, six existing cloud cases and 11 existing train-first cases, with zero failures or skips. TypeScript no-emit then passed at native exit `0` from 22:22:16.483 to 22:22:19.864 UTC. Root parsed actual results and verified all 19 finite before/after/current input hashes. This is not a transitive dependency closure.

Evidence: `MAIN/_private/figment-prepared-gen-status-verification-20260912-v1`. Raw reporter SHA: `d17fdbda589d35ae3fb85045a7eaede681b354881700cbee9f73dfae17103c0d`. Exact commands, native exits, raw streams, actual cases, source copies and pin inventories are retained. Review ran no duplicate checks.

Coverage includes exact plan/manifest digests and run limits, canonical contained paths and reparse refusal, malformed/oversized/deep metadata, producer `complete:gen` and failed-launch shapes, contradictory stage/receipt state, gen's three recorded files per job, sanitized failure/teardown fields and metadata immutability. Missing or garbage image files do not change the result because this is recorded metadata only. Rehashed observations provide a bounded cooperative-filesystem consistency check, not an atomic snapshot against hostile concurrent writers.

Next: the separately reviewed GET @2 and plan-card wiring, retaining POST @1 and existing preparation/intent semantics. No deployment, real-media acceptance, full operator-journey completion or paid-run authorization follows from this collector acceptance. `MAIN` is `C:/Users/danie/kb`.
