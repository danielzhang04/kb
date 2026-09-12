# Bounded Studio Claude work order

Status: prepared locally for specific consent; no dispatch under this work order has occurred. This is a proposed scope, not evidence that approval has been granted.

## Result

Complete the isolated video review-claims panel and authenticated server reader, with regression tests and independent security review. The Python reader remains the sole evidence validator. Results remain self-reported, unauthenticated and nonpromotable. Wiring into the application and a real-media integration run are subsequent work.

## Destination and private data

Claude Sonnet and Claude Opus through the existing local Anthropic subscription CLI. The CLI sends its permitted source context to Anthropic; it is not an offline model. The proposed consent covers the source files listed below, their resulting revisions, relevant project instructions, root work orders, synthetic test data, sanitized test results and review feedback, for this bounded implementation/test/review cycle. It excludes credentials, actual media, private card/ledger/job telemetry and provider operations.

The existing pending UI review is included explicitly: MAIN/_private/figment-video-ruling-ui-opus-20260912-packet.txt, 21,794 bytes, SHA-256 520f3fa5787096f5db397815536c18f3726f20344342aac1cb375f7a2ff126b2, to Claude Opus for one independent review. Earlier automatic rejections remain in force until this scope is approved. Do not substitute another destination or retry on unchanged evidence.

## Worktree and permitted files

REVIEW is C:/Users/danie/kb/_private/codex-worktrees/figment-research-review-20260909, branch codex/figment-research-review-20260909.

Sonnet implementation and test workers may read and revise these four current files, and Opus may independently review them and their revisions:

- dashboard/shared/figmentVideoRuling.ts
- dashboard/src/figment/VideoRulingRead.tsx
- dashboard/server/figment/videoRulingContract.test.ts
- dashboard/src/figment/VideoRulingRead.test.tsx

Sonnet may create and revise these new files, with independent Opus review of resulting source/test revisions:

- dashboard/server/figment/videoRulingRead.ts
- dashboard/server/figment/videoRulingRead.test.ts

Read-only supporting source and configuration:

- dashboard/server/figment/studioPlanProcess.ts and studioPlanProcess.test.ts
- dashboard/server/figment/studioGenPlan.ts and studioGenPlan.test.ts
- dashboard/server/http/middleware.ts
- dashboard/server/auth/session.ts
- orgs/figment/pipeline/video/video_delivery_ruling_assertion.py: schemas, limits and public result construction
- orgs/figment/pipeline/video/video_delivery_review.py: _validation_projection
- dashboard/package.json, package-lock.json, tsconfig.json and vitest.config.ts
- Binding CLAUDE.md, governance/agent-rules.md, governance/security-rules.md, orgs/figment/contract.md and pipeline/GUARDRAILS.md instructions; no credential values or stores.

Workers may write task-specific reports and synthetic test outputs inside their individually assigned MAIN/_private/figment-* directories. Source permission is restricted to the six writable files above. No application entrypoint, auth implementation, Python authority, dependency, governance or ledger edits.

## Execution and review bounds

1. Sonnet authors the new route from the prepared v2 task. Root corrected the earlier brief: requireSession is in server/http/middleware.ts; SessionConfig is in server/auth/session.ts. No worker launched from the rejected v1 task.
2. A separate Sonnet worker authors adversarial tests for authentication, closed configuration and request schemas, fixed command arguments, cross-ID concurrency, uncertain-termination quarantine, confirmed-dead release, malformed output and sanitized responses.
3. Sonnet runs the named Studio suites and dashboard typecheck locally, with before/after source pins and actual per-case results. Synthetic inputs only; no real credentials or providers.
4. Opus reviews the new route and the existing exact UI packet independently. Root adjudicates findings; Sonnet repairs confirmed defects, with at most two source repair rounds before a new root decision. Resulting revisions, relevant test results and review feedback remain in this same proposed consent scope.
5. Root reviews all changes and evidence before accepting or committing source. No independent-review or runtime claim may be inferred from a successful worker exit alone.

No paid compute, installation, push, merge, deployment, account action or publication is included. This work order does not authorize the separate private bookkeeping transfer or accept either rejected input/auth candidate.

## Current input pins

The appendix below identifies present files; permission for resulting revisions is explicitly limited to the implementation/test/review cycle above.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| dashboard/shared/figmentVideoRuling.ts | 8458 | 10993d18d32fa339ff6228bb826e4bee2e3c9712b0623cb745b139888c52704f |
| dashboard/src/figment/VideoRulingRead.tsx | 9568 | f347f9c9251a0718d088a6742fbb5ab89c1128d93c0bb5beb3c8e20fa950a6d6 |
| dashboard/server/figment/videoRulingContract.test.ts | 11778 | 98ab68846e8d64c85eb990ddaeb51005a462c29613c1a04da44cda452ad46112 |
| dashboard/src/figment/VideoRulingRead.test.tsx | 22833 | 23a91e68099845bf0a69a54f52d5d956c94df504c628c38127dd7f27f39b1b08 |
| dashboard/server/figment/studioPlanProcess.ts | 13365 | 26ebed1b720eedf11a081c7adc5bcf3f6b25e22761fdcba4b6d25ad7d287fbbb |
| dashboard/server/figment/studioPlanProcess.test.ts | 22311 | 61cbbb6c97d842c1617683b818efffc14857b1a7ec2d113f5c9d3bdce78ab7da |
| dashboard/server/figment/studioGenPlan.ts | 20082 | 007a6bdd8f5e9e314bf921d55de326215623475c628d824b66f90e7300986547 |
| dashboard/server/figment/studioGenPlan.test.ts | 27492 | 2cdb8fd3dc99ab3833fb0d1cb1435dc81fdbdb5a32e4b970d2d5ed2c23ea1610 |
| dashboard/server/http/middleware.ts | 12915 | 1e059d8d98400b4b88c8d9f1136356230fb0a9ff57b089c0455fe1b20be72916 |
| dashboard/server/auth/session.ts | 16609 | ccdb5d3e3bd6568a396cb43cacae835df6b26e77e207e2c28baf96b279d6f06a |
| orgs/figment/pipeline/video/video_delivery_ruling_assertion.py | 13419 | 77187b1c84b101d6fc3801916ff81409f628ca52c62cb75ba7b418ffd0431460 |
| orgs/figment/pipeline/video/video_delivery_review.py | 69726 | f4458ea22bf31d21a2c1a87e5e7f97110044e388edf133e4496d102bd6346319 |
| dashboard/package.json | 1484 | 16a7642439b1e2684863232ee031b78efaa299b1e3dda0826d4a5d6fc2209144 |
| dashboard/package-lock.json | 177431 | 8d61a964496ed78b4013be8eea3a28160108551d7dfc8010245656d0d38c4136 |
| dashboard/tsconfig.json | 1234 | 650227a78f8cba933cd34bf75b922bcc1d8f46ecca29cc84fac057d41712f03f |
| dashboard/vitest.config.ts | 984 | 0913b5f25f72cc6df58e8ae8353af16dc44b29b7948fa2ef96ba78513db81044 |
| CLAUDE.md | 2678 | e429f36bf12fa48ad31d46c8903d507c8f8a49eeb9eb25facd49bc0253a87811 |
| governance/agent-rules.md | 2501 | c3f5d3d849bf2856685751f0c5bd00f370feda173098b8624bfd1f207356dc24 |
| governance/security-rules.md | 1048 | 2917a6253318fb7216d944c8f0f283af0b9f3acd57f695052ea314223e25693f |
| orgs/figment/contract.md | 3908 | 7e9cacb633085cfac97b2172657e6f5d1577b34b70f9d09d1c23b4d2d8e1647e |
| orgs/figment/pipeline/GUARDRAILS.md | 3845 | 3157e920ca96a65efdbfe40bb9ff49c58b77ba93e7a7b48a3acf58c88dd16ba6 |
