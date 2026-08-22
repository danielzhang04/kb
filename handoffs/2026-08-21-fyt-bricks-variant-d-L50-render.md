# Bricks Variant D — L01–L50 generated, efficacy-audited, rendered over the VO — handoff 2026-08-21

**Topic:** Boss session took the Variant-D fragment from L01–L25 (25 verified) to **L01–L50: 47 verified / 3 parked**, after a fresh-eyes script-fidelity audit repaired 13 L01–L45 shots and L46–L50 were authored (A2 opening, Wiles arrival), and rendered the slice over the real narration for Daniel's eye-gate. Consumes and replaces `2026-08-21-fyt-bricks-variant-d-L25.md` (deleted in this push). Resume = Daniel watches the preview + board and rules; nothing in flight.

All work in the STANDALONE CLONE `C:/Users/danie/kb-clones/bricks-arc`, branch **`claude/bricks-variant-vd`** (pushed). Main kb checkout untouched (another terminal holds it on `claude/dashboard-v3`).

## Daniel's rulings this session (binding)
- "Gen another 25 through the skills (VPW + image-gen), chain into a render over the voice script, double-check script↔image efficacy in VPW" = the verdict on the 25-row board: **continue D**. Spend for the waves implied; reported per wave.
- Keep-awake armed for every Claude/codex CLI (pid-only 14 h lease `bricks-L50-run` on the boss session + 2 idle-expiry leases; AC only by design).

### What WORKED (with evidence)
- **Efficacy audit** (codex sol, `V/scratchpad/vpw-var/efficacy-audit-L01-L45.md`): 32 MATCH / 11 LOOSE / 2 MISMATCH; the two mismatches were real disclosure defects (L01/L03 showed the brick before its reveal line). Systematic causes named: premature brick disclosure; symbols too far from lines that name a date/comparison/buyer/fraction; sparse staging on craze/quantity/sale beats.
- **VPW extension** `07ec0fad` → critic `93c2b67c` → repair `fda1e62f`: 13 audit rows repaired at mechanism level, L36 restaged on a `'COMPAQ'` purchase order (`compaq` elevation dropped from `needed_assets`), L46–L50 authored (`miniscribe-rep` slump, `hq-banker` ×3 with the `bank-rescue` hold, `qt-wiles` reveal). Lint `--write --fragment`: 0 HARD, covered 333/1628, 50 shots, zero growth vs vb (new shots ≤45 words). Independent critic: ship-with-edits, 6 findings, all 6 accepted (L39 doubt withheld to its line; L22 crowd contained; L37→L38→L39 and L16→L17 became holds; L49 dominant delta).
- **Generation** — three sequential codex-sol waves (parallel worktrees rejected: `visual-kit/_staging` is 3.2 GB and gitignored): 3A `e49f72e9` 25 calls (18-shot window: 11 regens + L26–L32), 3B `aa34b23d` 25 calls (L33–L50), 3C `ca00f77b` 21 calls (park repairs under boss-granted allowances). Final `V/scratchpad/variant-frames/vd/manifest.json`: **50 rows, 47 verified, 3 parked, 108 calls, $14.472 conservative / $4.212 provider-table**, SHA-256 reconciled by the boss after every wave. Superseded frames kept under `variant-frames/vd/_superseded/`; 31 pre-D scene files archived to `V/assets/_archive-pre-vd-2026-08-21/` (they blocked `forge.py batch`: stale parked L48 parent).
- **Independent Sonnet pixel checks** (transcript-grep verified `claude-sonnet-5`, recorded as "Boss grading note" blocks in `genlog-vd.md`): 3A 12/15, 3B 9/10, 3C 9/10 concur. Standing dissents: L22 (packer row reaches the camera edge — both retries spent), L03 (trophy metaphor loose), L49 (bridge frame, Wiles withheld by design).
- **Render** (codex terra, render-builder skill): `assets/voiceover.manifest.json` = the vpw2 forced-alignment manifest (1,632 words match `script.md`; VO 539.915 s); motion `per-line-timings`, 50 shots, cuts on vo_ref onsets (L01→L02 1.623 s, L24→L25 53.852 s, L45→L46 103.998 s); `--preview-parked --allow-missing` (parked L10/L38/L39 render as placeholder cards — their staging pixels are outside the engine's resolution path); `assets/board.html` = 50 cards with honest badges. Trim worker cut the slice at L50's line end (see Exact Next Step for the final duration).
- **Ledger**: waves 3A/3B/3C rows pushed to ops `ledgers/cost/claude-boss-2026-08-21.tsv` (`127e87e8`).
- **Platform fix**: codex 0.149.0 rejects `approval_policy = "untrusted"` at config load → dispatch says "auth stale". Clone `.codex/config.toml` → `on-request` (`718c8113`); main kb fixed by the dashboard terminal (`432a49db`).

### What Did NOT Work (and why)
- **Codex 0.149 config break** cost the first dispatch; root-caused in 3 commands (home config had been patched today, repo copies not).
- **Stale pre-D residue in `assets/scenes/`** made `forge.py batch` refuse the whole file (validates every chain, not just `--shots`); fixed as wave-3A Step 0 (archive).
- **Figure cards are the defect-dense layer again**: 3B spent 9 of 25 calls on STEP-1 cards; `miniscribe-rep` pose/expression variants and the `ibm-suit` costume drifted (three arms, teal jacket). 3C fixed them with canonical-scaffold card routes.
- **Engine bakes unrequested prop text** (L44 EXIT sign, L40 labels, L13 earlier) and **loses supplied literals under deltas** (L38 lost `600 MILLION` after the inflation change → L39 blocked). L10's crowd rig failed three mechanisms (Victorian queue, tall figures, invented photographers) — product-only restage still grew a crowd.
- **Render re-timer lets the last shot absorb the rest of the narration** (L50 = 431 s hold → 546 s file); a post-trim was required. `--preview-parked` cannot show parked pixels that live only in `visual-kit/_staging`.
- **Worker `git add` paths**: my per-wave commits staged `V/assets` + scratchpad only, so the gen workers' retry re-authorings in `shots.json` sat uncommitted until the end (`a3eeda27`); the mirror worker reconciled the fragment/no-growth record afterwards.

### What Has NOT Been Tried Yet
- Daniel's eye-gate on `assets/preview-L01-L50.mp4` + `assets/board.html` (local, gitignored).
- L10 / L38→L39 repairs beyond the granted allowances (L10: drop the crowd entirely or accept a figure-less launch tableau; L38: make the inflation change a second object so the lettered weight is never re-rendered).
- Render-register experiment (grain / dust-beam / painterly grade) — still the dominant viewer-felt gap vs LIKED.
- A2+ authoring (L51 onward) under D; the `compaq` personification only if Daniel prefers it over the purchase-order staging.

### Current State of Files (clone, branch `claude/bricks-variant-vd`)
| File | Status | Notes |
| ---- | ------ | ----- |
| `V/shots.json`, `V/scratchpad/vpw-var/fragment-A1-vd.json`, `plan-vd.md` | DONE | 50 shots under D; efficacy + critic dispositions; no-growth table |
| `V/scratchpad/vpw-var/efficacy-audit-L01-L45.md`, `critic-vd-L50-findings.md` | DONE | fresh-eyes records |
| `V/scratchpad/vpw-var/genlog-vd.md` | DONE | waves 1–3C call tables + boss grading notes + ops cost rows |
| `V/scratchpad/variant-frames/vd/` (+ `_superseded/`, `manifest.json`) | DONE | 47 frames, SHA provenance, 108 calls |
| `V/assets/scenes/` + `manifest.json`, `_review/merged.json` | DONE | 47 verified / 3 parked; pre-D residue in `_archive-pre-vd-2026-08-21/` |
| `V/assets/voiceover.manifest.json`, `vo.txt`, `motion/long-form.motion.json`, `render.manifest.json` | DONE | tracked render inputs/outputs |
| `V/assets/preview-L01-L50.mp4`, `_render-untrimmed-546s.mp4`, `board.html` | DONE (local only, gitignored) | Daniel's eye-gate deliverables |
| `.codex/config.toml` | DONE | `approval_policy = "on-request"` |
| `kb-clones/bricks-arc-v{a,b,c}/`, `.pytest-vd-task1-baseline/`, `tmp/pytest-img-go-with-edits/` | TODO | ACL-locked residue; needs an elevated shell |

(`V` = `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh`.)

### Exact Next Step
Open `C:/Users/danie/kb-clones/bricks-arc/<V>/assets/preview-L01-L50.mp4` (117.97 s, L01–L50 over the narration; L10/L38/L39 are placeholder cards) and `<V>/assets/board.html`; rule: keep going under D (author + gen A2 onward, repair L10/L38/L39 with a fresh allowance) / fix the register first (render-register experiment) / revert. Name any frame that still doesn't belong to its line — the efficacy audit + Sonnet dissents (L22, L03, L49) are the open calls.

### Load list
- this file; personal memory `bricks-taste-forensics-arc.md`, `occupancy-middle-ground.md`, `detached-codex-dispatch.md`, `codex-0149-approval-policy.md`
- clone: `V/scratchpad/vpw-var/genlog-vd.md` (waves 3A–3C + grading notes), `efficacy-audit-L01-L45.md`, `critic-vd-L50-findings.md`, `plan-vd.md` (§ Efficacy disposition, § Critic disposition), `V/scratchpad/variant-frames/vd/manifest.json`
- skills: `dispatch-codex` (detached Start-Process pattern), `save-session`
