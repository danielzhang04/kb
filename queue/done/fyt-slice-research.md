---
id: fyt-slice-research
project: faceless-youtube
action: research:slice-dossier
target: orgs/faceless-youtube/channels/the-second-take/videos/2026-08-06-slice-test
risk-tier: T1
owner: dashboard-engine
claim-token: null
state: done
approval: null
workflow: null
depends-on: []
variant-group: null
role: work
session-id: null
runtime: null
model: null
execution-controller: dashboard
profile: research
---

## Work order

# Research stage — minimal dossier for the slice video `2026-08-06-slice-test` (The Second Take)

Follow the project research skill at
`orgs/faceless-youtube/.claude/skills/researcher/SKILL.md` for
`videoDir = channels/the-second-take/videos/2026-08-06-slice-test` (channel `the-second-take`,
slug `2026-08-06-slice-test`). This is a **platform-acceptance slice run: minimum viable scope,
flow correctness over content quality.**

The picked idea is already in `channels/the-second-take/videos/2026-08-06-slice-test/brief.md`:
a standalone **~60–90 s money-story short** — *"The Man Who Sold the Eiffel Tower — Twice"*
(Victor Lustig, 1925 Paris; posed as a government official, ran a rigged scrap-metal "auction" of
the Eiffel Tower to solicit a bribe, escaped because the humiliated mark stayed silent, then ran it
a second time). Read the brief first; the dossier serves that short and nothing wider.

### Scope (keep it minimal — this is a slice, not a full deep-research run)
- Produce a **tight** dossier: only the handful of load-bearing facts the ~60–90 s script needs.
  Do **not** write a full-length research report. A page or so is right.
- **Verify-before-script (channel YMYL gate):** confirm each load-bearing claim against **at least two
  reputable sources** and cite them inline with a `[F-NN]` fact-ledger, exactly as the researcher skill
  specifies. Load-bearing facts to nail: the year (1925) and that a second attempt occurred; Lustig's
  posed official title; the "scrap-metal auction of ~7,000 tons of iron" framing; the bribe mechanism;
  and that the first mark did not report it.
- **Source-or-omit:** if a specific figure/title cannot be sourced to two reputable references, **omit
  that element and flag it for the scriptwriter** — never invent a plausible-sounding value. (operating
  law §research: fabricated facts about a real person are a hard-blocking defect.)

### Cost / authority (binding)
- **No paid spend.** Read-only WebSearch/WebFetch only (this stage's `research` profile grants exactly
  that plus Read/Write). Never handle, print, copy, persist, or transmit any credential.
- Take **no external action** beyond read-only lookups. Write no file outside the staging path below.

### Single-writer staging rule (load-bearing)
- Write your dossier to **`channels/the-second-take/videos/2026-08-06-slice-test/staging/research.md`**
  (the `staging/` dir already exists). Do **not** write to the video root — the conductor merges
  `staging/research.md` → the root and re-checks it. Say in your Result that you wrote to staging.

### Exit condition
- `staging/research.md` exists, every load-bearing claim carries a two-source `[F-NN]` citation (or is
  explicitly omitted-and-flagged), and it is scoped to the ~60–90 s short.

### Result
Append a `## Result` section: the repo-relative path you wrote, the count of facts verified vs.
omitted-and-flagged, the sources used, and a one-line honest status. Do not overstate — if a fact
could not be two-source verified, say so plainly.

## Bridged run

This trigger card was consumed by the dashboard engine and run as run-92d33b09-235c-4b50-a976-191fc196e763.
