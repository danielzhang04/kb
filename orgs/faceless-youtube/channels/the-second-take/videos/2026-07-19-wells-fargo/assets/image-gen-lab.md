# image-generation lab — 2026-07-19-wells-fargo (fyt-run-001)

Append one block per round. Frames live in `assets/library/`; the per-round reasoning lives here.

---

## Round 1 — 2026-07-20 — Pass-1 character lock (COMPLETE) + Pass-2 HALTED at the spend gate

**Engine:** `gemini-3-pro-image` (registry `engine`; flash is banned, `stack.md` 2026-07-09).
**Calls used: 4.** Estimated spend **~$0.54** at the $0.134/img 2K pro tier.
**Scope run:** Pass 0 skipped (`needed_assets` is empty). Pass 1 complete. **Pass 2 not started.**

### Pass-1 outcome — 3/3 locked

| Character | Gens | Verdict | Shots |
| --- | --- | --- | --- |
| `kovacevich` | 1 | PASS, no retry | L27 |
| `stumpf` | 2 (1 retry) | PASS on retry | L81, L96 |
| `tolstedt` | 1 | PASS, no retry | L94, L96, L105, L109 |

All three seeded off `refs/base/base.png`, `--mode new_character`, `2:3`, style-only descriptor with the
§2c RIG-HOLD block auto-appended by `forge.py`. Per-asset seed/technique/verdict detail is in
`assets/library/manifest.json`.

**Not promoted to the channel registry** — these are Wells-Fargo-specific executives, unlikely to recur
in later videos, so they earn a per-video library slot only (skill Pass-1 step 6 criterion). The channel
`registry.json` was deliberately left untouched.

### Two findings worth keeping

1. **A false-positive nose call nearly cost 2 gens.** `kovacevich` gen 1 appeared to carry a small nose.
   A deterministic side-by-side midface crop against `refs/base/base.png` showed the *approved canonical
   carries the identical shape* — it is the rig's chin/lower-lip detail, below the mouth, not a nose.
   Bible §3 already says to judge against the approved canonical rather than an idealised rig, and that
   over-calling a rig fail costs as much as missing one. **Cut the comparison crop against the canonical
   before ruling a nose/ear FAIL** — the ruling is cheap, the regen is not.

2. **Authoring a receded hairline invites drawn ears (my own defect, not the engine's).** `stumpf` gen 1
   used the delta "THINNING silver-white hair, higher at the temples", which exposed the flat side of the
   head; the engine filled it with fully-drawn ears (inner helix visible at 3–4× —
   `stumpf--stumpf--ear2.png`). The re-authored retry moved age onto **build, brow and mouth linework**
   and authored the hair as a **full side-covering sweep from temple to jaw**, and the ears vanished in
   one gen. Generalises to: *on a no-ears rig, never author a receding/thinning hairline for an elderly
   character — carry age on build and linework, and state the side-fill positively.* Candidate for the
   bible §3 hair/side-gap note or the VPW authoring rules — **not yet codified; needs human confirmation
   (operating-law §G).**

### Authorisation check — holds; Pass 2 proceeds

Pass 2 is scoped at 119 long-form scenes (114 plain + 5 layered plate/cutout pairs) + 3 thumbnails,
≈130 further calls ≈ **$17–18**, with a 200-call (≈$26.80) working ceiling.

Authorised by parent card `queue/working/6a5d53ea-562cad3a.md` (`build:video-run`, workflow
`fyt-run-001`), which quotes Daniel's verbatim 2026-07-19 instruction and explicitly covers **one
video's standard pipeline API usage (ElevenLabs TTS + Gemini image gen, ~$15–30 per `stack.md`)** on the
ambient `.env` keys. My own card is `6a5d53ea-aac22743` (`build:scene-images`, T2, `working`).
`scripts/preamble.py` returns **PREAMBLE OK**.

> **I got this wrong first and it cost a detour.** I searched `queue/` from the `C:/Users/danie/kb`
> worktree, which sits on `codex/dashboard-operational-surfaces`, found only cadence cards, and wrote up
> a spend-gate halt. **Coordination state lives on `ops`** (kb constitution, Branch rules) — the `ops`
> queue holds the whole `fyt-run-001` DAG. Read `queue/` from an `ops` checkout before concluding
> anything about a card.

Residual, surfaced but **not blocking**: `governance/budget.yaml`'s `daily_usd_limit: 5.00` and
`stack.md`'s ~$15–30-per-video budget cannot both hold. The gate passes only because image spend is
never written to `ledgers/cost/` (today's rows are all `0.0` subscription steps), so it measures nothing
real. Governance question for Daniel, not a per-run workaround.

Also stale: **`stack.md`'s Gemini spend-log row still records image gen as billing-blocked (429) from
2026-07-03. The key generates** — 4/4 calls returned images.

### To resume Pass 2 (no rework needed)

Pass 1 output is durable and complete, so a resumed run starts straight at Pass 2:

- Seed each cast figure from `assets/library/<name>.png` + its `pose_ref`/`expression_ref` frame. All 8
  refs the `cast` arrays name (`action-present`, `sit`, `action-armscrossed`, `carry-by-handle`,
  `hold-one-hand`, `expr-smug`, `expr-worried`, `expr-deadpan`) resolve by registry **`name`** — present
  and correct, nothing missing.
- **Stage names must be prefixed** (e.g. `wf-L01`). `visual-kit/_staging/` still holds Poyais frames
  named `L01.png`–`L125.png`; `forge.py gen` skips a name that already exists in staging, so unprefixed
  Wells Fargo gens would silently inherit Poyais art. Place, then rename to `scenes/<shot-id>.png`.
- 6 shots carry `cast` (L27, L81, L94, L96, L105, L109); the other 113 are character-free technique (c)
  and each needs a style-anchor seed. 88 shots carry authored text → also seed
  `refs/env/lettering-marker-italic.png`. 14 shots are crowd-bearing → also seed
  `refs/base/crowd-exemplar.png`. 12 shots are delta-chain across 6 chains
  (L05→L06, L07→L08, L11→L12→L13→L14, L33→L34→L35→L36, L37→L38, L77→L78→L79→L80) and must generate
  in order.
- 5 layered shots (L31, L44, L90, L99, L101) need plate + magenta-field cutout; cutout gens must **not**
  be 16:9 (`forge.py cutout` hard-errors ≥1.5 aspect).

---

## Round 2 — 2026-07-20 — Pass-2 resumed by the orchestrator

Round 1 ended not at a spend gate but at a **stream watchdog**: the agent driving the batch was
killed after 600s with no output, because `forge.py cmd_gen` buffered every result and printed only
after the loop. 18 frames had landed before it died. Pass 2 was resumed by running the waves as
**detached background shells** rather than inside an agent — an OS process has no stream watchdog.

### Two infrastructure lessons, both of which cost real money

1. **`python` and `py -3` are DIFFERENT interpreters on this box.** `python` is
   `C:\Program Files\Python312\python.exe` and has **no Pillow**; `py -3` is
   `...\Programs\Python\Python313\python.exe` and has Pillow 12.3.0. `forge.py` needs Pillow in
   `to_png_bytes` to normalise the engine's JPEG to the pipeline's PNG contract — and that call
   happens **after** the paid API call. So running a batch under the wrong interpreter generates
   every image, pays for every image, and writes none of them: `ERR No module named 'PIL'` on every
   row. **Always invoke forge with `py -3`.** A first relaunch under `python` burned an estimated
   10–25 calls (~$1.50–3.50) this way before it was caught and killed.

2. **Buffered batch output hides a systematic failure until the whole batch is paid for.** Fixed at
   the source (`4f30c66`): `cmd_gen` now reports each result as it lands with an `[n/total]` counter
   and a closing tally. The general rule — *a loop that spends money per iteration must report per
   iteration, never per batch* — belongs in the skill, not just here.

### Sequencing that the batch files imply (worth stating, it is not obvious)

Chain follow-ons seed from `assets/scenes/<id>.png` — the **placed** path, not `_staging/`. So the
order is strictly: plain waves + plates + cutout sources → **place into `assets/scenes/`** → chains →
place chains → `forge.py cutout` on the `-src` frames → render. Running chains before placement fails
on a missing seed.
