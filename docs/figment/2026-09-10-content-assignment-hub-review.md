# Content assignment hub independent review — 2026-09-10

**Verdict: READY.** This review covers the read-only assignment snapshot
projection and its Research-tab label. It does not establish current image
approval, slot suitability, asset readiness, publication readiness, or a
deployed dashboard.

## Frozen files

- `dashboard/server/figment/contentBriefs.ts` — `8f6ce7a9599c21926d6662ef706513589cee5fb757b05ec448b9bfb60c07d70a`
- `dashboard/server/figment/contentBriefs.test.ts` — `e6b0aefe55cf8c76a63d380d69be5158c345649bf7e0dc7a9ae55069d9952d6b`
- `dashboard/server/figment/routes.test.ts` — `402f47a296159fe452dbcbaa643eb88fa102433c9d27ef3bb02bf37ed56412fa`
- `dashboard/src/figment/FigmentWorkspace.tsx` — `ebbe65416d1ef54a4d4da58cdc1782ec7368783aa73848c5623d228d7b429a59`
- `dashboard/src/figment/FigmentWorkspace.test.tsx` — `7b1e662ec0066650b555928f4fba57bde3b25cfbb500f11917c8e32f8e21304a`
- plan — `030396bb7c5b72dd0fc37df32f3d0539b6a4983059b4e40637dbaa6996da66fc`

## Findings and verification

The collector reads only fixed sibling `assignment.json`, compares the raw
brief digest and exact supported persona/non-G slot structure, rejects duplicate
image IDs and malformed or linked evidence, and projects only `missing`,
`recorded-snapshot`, or `unavailable`. Paths, hashes, image IDs, attribution,
prompts, and approval records do not reach the route or UI. Older payloads map
an absent assignment field to missing, and React renders the label as text.

The reviewer ran the three focused Vitest files: **59 passed in 6.26 seconds**.
`npm.cmd run typecheck`, `npm.cmd run build` (129 modules), and `git diff
--check` also passed. All six file hashes matched the author's freeze.

Root separately repeated an actual producer-to-collector probe at 04:20:32,
which returned a creator-002 two-slot recorded snapshot, and inspected 1440px
recorded plus 500px missing/unavailable screenshots. Root's result and qualified
layout evidence are recorded at
`MAIN/_private/figment-content-assignment-hub-root-20260910-v1/browser-qa/result.json`.
That browser fixture is local and does not prove authenticated deployment.

The label intentionally reports a recorded planning snapshot. The collector
does not re-run current gen approval or slot-fit authority and must not be used
as an approval or publication gate.
