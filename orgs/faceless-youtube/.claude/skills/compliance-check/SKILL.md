---
name: compliance-check
description: Produces the mechanical + provenance Gate-3 report a human reads before approving a publish. Use for "run compliance", "the Gate-3 check", "is this video publish-ready", "check policy/limits before publish". Reads render.manifest.json, metadata.json, scenes/manifest.json, thumbnail.png, audio-plan.json, library/manifest.json, script.md, research.md; writes compliance-report.md (PASS/FAIL, exit 0/1). Runs after render-builder, before publish-queue. Read-only — never publishes or edits. Do NOT use to assemble the video (render-builder) or upload (publish-queue).
---

# compliance-check

Render the objective, mechanical Gate-3 report a human signs off on before a publish. This skill is a
**read-only gate**: it reads a finished video folder and writes one file, `compliance-report.md`. It
never publishes, uploads, or edits the video. **Stage-0 law holds above everything: a human approves
EVERY publish, and every upload goes out `private`** — this report exists to make that human decision
fast and well-grounded, not to replace it.

## Where this sits in the pipeline

`render-builder` → **compliance-check** → `publish-queue`

- **Reads (all committed, in `channels/<name>/videos/<slug>/`):** `assets/render.manifest.json`,
  `metadata.json`, `assets/scenes/manifest.json`, `assets/thumbnail.png`, `audio-plan.json`,
  `assets/library/manifest.json`, `script.md`, `research.md`.
- **Writes:** `compliance-report.md` — a `## Mechanical checks` section (each line
  `PASS|FAIL — <check>`) plus a `## Provenance (warn-level)` section.
- **Exit code is the contract.** `0` = PASS (every mechanical check passed), `1` = FAIL. The Task-9
  `publish-queue` preflight consumes this exit code as a **hard gate**; the runner (Task 11) invokes
  the same CLI.

## How to run it

The engine is `scripts/compliance_check.py` (Python 3; stdlib + **Pillow** for the thumbnail
dimension check — no network, ever). Use `py -3` on this machine.

```bash
py -3 .claude/skills/compliance-check/scripts/compliance_check.py channels/<name>/videos/<slug>
echo $?   # 0 = PASS, 1 = FAIL
```

It writes `channels/<name>/videos/<slug>/compliance-report.md` and prints the same text to stdout.

## The two kinds of finding

**Mechanical checks are the hard gate. Any single FAIL → exit 1 → publish blocked.** Each check is its
own function returning `(ok, detail)`; a check that errors is treated as a FAIL (a gate never crashes
open).

1. **render manifest** — every piece in `render.manifest.json` has `state == "rendered"`, `audio.ok`
   is true, a measured LUFS is present, `audio.measured.splice_continuity.fail == 0`, and a positive
   rendered duration. (Field names pinned from the real wells-fargo manifest.)
2. **metadata limits + chapters** — under `long_form`: title ≤ 100 chars, description ≤ 5000 **bytes**,
   total tag chars ≤ 500, `category_id` present, and chapters strictly monotonic and each **before**
   the finished duration (duration read back from the render manifest).
3. **privacy + AI disclosure** — `defaults.privacy_status == "private"` and
   `defaults.contains_synthetic_media == true`. This is the Stage-0 policy floor.
4. **licensing / credits** — two directions, both convention-based (substring matching), on every
   asset in `audio-plan.json` / `library/manifest.json` that declares a license/attribution field:
   - *credited*: every such licensed asset's credit string or id appears somewhere in the description.
   - *no orphan credits*: every entry in the description's **Credits block** (see below) matches at
     least one licensed asset's credit string or id.
   The description MAY contain a Credits block: a contiguous run of lines starting right after a line
   matching `^credits:?$` (case-insensitive, optional markdown heading `#`/`##`/... or bold `**`
   markers around the word), and ending at the first blank line or end-of-description. Each non-empty
   line in that block is one credit entry. No Credits block present → orphan detection is vacuously
   fine (there's nothing to check). Matching is convention-based, not semantic — a credit block is
   required for orphan detection to see credits at all; a credit buried outside a recognized block, or
   phrased so it shares no substring with the licensed asset's credit/id, will not be caught either
   way. (Vacuously green on both directions when nothing is licensed and there's no Credits block —
   the current corpus is all `source: generated`/`reused`.)
5. **thumbnail 1280×720** — `assets/thumbnail.png` exists and is exactly 1280×720 (verified with PIL).
6. **scene-review invariant** — every entry in `scenes/manifest.json` is shippable under **Task-2
   semantics**: `review_status == "verified"`, or (when `review_status` is absent) legacy
   `verified.scene` **and** `verified.rig` both true. Any `parked`/`unreviewed`/other status → FAIL,
   naming the offending shots. This logic **mirrors** `render-builder/scripts/render.py::_entry_review_reason`
   (the source of truth) — it is restated here, not imported, so this gate has no render-builder dependency.

**Provenance is warn-level and NEVER affects the exit code.** It maps the `[F-NN]` citations in
`script.md` to `research.md`'s fact ledger and surfaces two hygiene cues for the human reviewer's eyes:
citations with no ledger entry (orphans), and any single source cited ≥ 5 times within a 200-word
window (single-source over-reliance). These are prompts to look closer, not gates.

## After it runs

- Read `compliance-report.md`. If the verdict is **FAIL**, the failing lines say exactly what to fix
  (re-render, fix metadata, generate the thumbnail, verify the parked shots) — this gate is not a
  human-judgment call, it is a checklist to clear.
- On **PASS**, the report is the artifact a human reads at Gate 3 before approving the publish. The
  human, not this script, gives the final go — and `publish-queue` still uploads `private`.
