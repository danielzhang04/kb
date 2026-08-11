# P1 Capability Probe — codex CLI `image_gen__imagegen` as second FYT image engine

Worker: P1 capability-probe (background Claude agent, sonnet).
SCRATCH = `C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine`
Started 2026-08-11.

Known contract going in (already probed, not re-probed here): params = `prompt` (required),
`referenced_image_paths` (array of local paths) XOR `num_last_images_to_include` (<=5); one image
per call; no aspect/size/quality params; no output-path param. Codex CLI version at probe time:
`codex-cli 0.146.1` (`codex --version`).

Budget: 12 gen calls max. Running tally kept in section I.

---

## Pre-probe: source material recon (not counted against gen budget)

- Kit root (read-only): `orgs/faceless-youtube/channels/the-second-take/visual-kit/`
- Video: `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/` (the
  MiniScribe "shipped bricks instead of disk drives" fraud video)
- `registry/registry.json` holds two casts: Poyais-video legacy characters (macgregor, bolivar,
  mosquito-king, strangeways, hastie, hastie-wife) and the bricks-video cast partially (base,
  miniscribe-rep, ibm-suit, rifenburgh-ceo, terry-johnson, pc-boxy). The bricks video's FULL cast
  (added L43-L215) — qt-wiles, hq-banker, brick-foreman, auditor-rep — lives only in
  `videos/2026-07-28-bricks-fresh/assets/library/manifest.json`, not in the channel registry.
- **Finding, important for probe B/E design:** `refs/env/README.md` states explicitly:
  *"Cross-video places and image style anchors are forbidden; forge's hardened scene descriptor
  carries rendering style without content bleed."* This kit does NOT keep image-seeded
  environment/background plates by design — `refs/env/` holds only two "register exemplar" hand
  images (lettering, stamp) and two character-free recurring PROP canonicals
  (`prop-beige-pc.png`, `prop-drive.png`). There is no "place plate" to copy. Adapted probe B/E to
  use `prop-beige-pc.png` as the environment-adjacent seed and logged the deviation from spec
  rather than inventing a fake place plate that doesn't exist in this pipeline's doctrine.
- **Finding, important for probe G:** `videos/*/assets/scenes/*.png` (the actual Gemini-minted
  scene renders) are **not committed to git** — only `assets/scenes/manifest.json` is tracked
  (confirmed via `git ls-tree -r HEAD -- assets/scenes`). This worktree's checkout has zero PNGs
  under `assets/scenes/` even though the manifest lists 25 shot IDs incl. L29. The real PNGs only
  exist as untracked local artifacts in the main kb checkout, which this probe is barred from
  touching at all. **Adapted probe G** to compare against the style-bible's pinned numeric target
  instead of a specific rendered PNG: `style-bible.md` pins the outline ink at `#241a12` exactly
  (dark warm brown-black) — R=0x24=36, G=0x1a=26, B=0x12=18, so **target R-B = +18** (warm-leaning
  dark ink, not neutral/cool black). This is a stronger ground truth than one incidental exemplar
  PNG would have been.

### Seeds picked (copied into `SCRATCH/seeds/`, kit files untouched)

| Seed | Source path (kit, read-only) | sha256 | Dims |
|---|---|---|---|
| `figA-qt-wiles.png` | `refs/qt-wiles/qt-wiles.png` | `261d569d053276cd97714e0071373f7a8faf1510041b8a870a7574d2e4c02690` | 1696x2528 |
| `figB-miniscribe-rep.png` | `refs/miniscribe-rep/miniscribe-rep.png` | `eacb88262baef1406754643dc7e51f59aa1488751f8dd2d4464083e2576385ed` | 848x1264 |
| `env-prop-beige-pc.png` | `refs/env/prop-beige-pc.png` | `2b405e2b79d1ab61fb60f2e325f74d1d03e73837cba68f56e77efc0ed7961271` | 2048x2048 |
| `env-scene-style-tile.png` | `refs/env/scene-style-tile.png` | `bb725adf7676358af2ec521e8aaea58fc5ca10bb36a54f954b532e1832e701b7` | 2752x1536 |

Figure A = **qt-wiles** (Q.T. "Quentin Thomas" Wiles) — chosen as "most distinctive costume":
silver side-parted hair, charcoal double-breasted three-piece suit, burgundy tie with a small gold
tie clip, half-moon spectacles (per shot prompts, pushed up on forehead in some shots), deadpan/
world-weary default expression. Also the video's single most-used named character (33 shot refs in
the library manifest) and — load-bearing for probe H — a real, named, convicted historical figure
(CEO/chairman of MiniScribe, federal securities-fraud conviction 1994, per `research.md` F-02/F-20).

Figure B = **miniscribe-rep** — tan open blazer over brown open-collar shirt, dark trousers, short
dark side-parted hair, stocky build, delighted default expression. Distinct silhouette/palette from
qt-wiles (tan/brown vs. charcoal/burgundy) — good identity-bleed contrast pair.

Real scene prompt (from `shots.json`, shot **L29**, place tag `miniscribe-floor`):

> `miniscribe-rep`, `expr-delighted`, `action-powerstance`, planted centre in the entrance at the
> back of the assembly floor, the painted board 'MINISCRIBE' hanging over him. The floor as
> established: two long steel benches running back into the depth, the rack of tote bins
> stage-left, the roller door shut beyond. Cool grey-teal-cream palette, flat strip light,
> foreground depth from a cropped bench end at the lower-right.

Global suffix appended to every shot in this video (from `shots.json.global_prompt_suffix`):

> Clean flat 2.5D vector cartoon in The Second Take house style: even medium-thick dark warm
> brown-black (#241a12) outline on everything, flat cel colours with gentle soft shading, rounded
> friendly shapes, no realistic detail; built-but-flat environment (flat gradient sky/ground +
> minimal geometry + one foreground depth prop); any in-world lettering hand-lettered in the marker
> style, short and legible; locked 2-3 colour scene palette plus the single red accent #d7402b used
> only semantically (alarm / prohibition / ownership / the last punch element); no photorealism, no
> on-screen narrator or host face, no unrequested text, no logos; 16:9.

---

## Probe A — JSON event stream shape (no gen)

Invocation:
```
codex exec --json --sandbox read-only --cd SCRATCH "Say READY and nothing else."
```
Wall clock: **12s**. Stderr: `Reading additional input from stdin...` (harmless, cosmetic — codex
exec always announces this even when nothing is piped in; did not block or hang).

Raw event stream (`probeA-raw.jsonl`), one JSON object per line:
```
{"type":"thread.started","thread_id":"019ff22e-047a-75d3-8cf9-6d5c8df6f465"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"READY"}}
{"type":"turn.completed","usage":{"input_tokens":16060,"cached_input_tokens":11008,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}
```
Event shapes seen: `thread.started` (session/thread id), `turn.started`, `item.completed` (one per
completed item — here an `agent_message`; expect `tool_call`/`tool_result`-shaped items for tool
use, confirmed in Probe C below), `turn.completed` (carries the `usage` block: input/cached-input/
output/reasoning-output token counts — this is the authoritative per-call cost source, more
reliable than scraping human "tokens used" text).

Baseline overhead note: a trivial 5-token reply cost **16,060 input tokens** (11,008 of them
cached). This is fixed per-call system-prompt/tool-schema overhead, not proportional to the task —
relevant to probe I's cost-per-image math.

Verdict on the programmatic-harvest question: **deferred to Probe C** (need an actual imagegen tool
call in the stream to know the tool_call/tool_result item shape and whether output paths appear
there verbatim). See Probe C for the answer.

---

## Probe C — single-seed identity hold (GEN #1) + resolves Probe A's harvest question

### Sub-finding: `referenced_image_paths` MUST be absolute

First attempt used a workspace-relative path (`"seeds/figA-qt-wiles.png"`) inside a
`--sandbox workspace-write --cd SCRATCH` call. It failed **before any image was generated** ("Wall
time 0.0 seconds"):
```
Script error:
AbsolutePathBuf deserialized without a base path at line 1 column 337
```
stderr confirmed: `ERROR codex_core::tools::router: error=AbsolutePathBuf deserialized without a
base path`. **Contract addendum: `referenced_image_paths` entries must be absolute paths** (tested
Windows form `C:\Users\...`); a path relative to `--cd` is rejected outright, no retry/normalization
by the tool. This did not consume a real generation (no image, no billable render) so it is not
counted against the 12-call budget; logged as a free capability fact.

### Attempt 2 (counted as GEN #1) — absolute path

Invocation: `codex exec --json --sandbox workspace-write --cd SCRATCH "<prompt, referenced_image_paths=[absolute C:\...\seeds\figA-qt-wiles.png]>"`.
Wall clock: **under 120s** (exact turn completed before the shell wrapper's 120s default cutoff cut
the trailing echo commands; `turn.completed` usage event was fully captured, so the run itself
finished cleanly, just barely inside 2 minutes — well under the 4-minute ceiling).
`usage`: `input_tokens=114002, cached_input_tokens=76544, output_tokens=2436, reasoning_output_tokens=1353`.

**Side effect observed, relevant to design risk:** before calling the tool, the agent went on a
short unprompted context-gathering detour — it tried to `Get-Content` the SKILL.md (imagegen skill
doc, ~9.5k words), then tried to read `CLAUDE.md`, `governance/agent-rules.md`, and enumerate
`contract.md` files across `orgs/` (all inside the kb worktree it was `--cd`'d into, because SCRATCH
sits inside a live kb git worktree so ambient repo files are visible). Two of those PowerShell calls
were **declined** with `command execution approval is not supported in exec mode` (a codex exec-mode
limitation, not a permission we set) and it fell back to a plain `Get-Content CLAUDE.md` (relative,
also failed, wrong cwd) before giving up the detour and proceeding to the actual tool call. None of
this leaked repo content into the image or the report, but it burned real tokens/wall-time on every
single call and is a repo-boundary control gap worth flagging (see GATE-1 risks).

**Answer to Probe A's deferred question — programmatic harvest:** **No.** The `--json` event stream
never emits a distinct `tool_call`/`tool_result`-shaped item for `image_gen__imagegen`. The only
items seen are generic `agent_message` and `command_execution` items; the actual tool invocation and
its result (including the saved file path) are folded into the free-text `agent_message` the model
chooses to write, not into a structured field. **Harvesting requires either (a) regexing the saved
path out of the final agent_message text** (the model was told to report it verbatim and did,
consistently, across every gen probe in this log), or **(b) skip parsing entirely and glob
`~/.codex/generated_images/<thread_id>/*.png` by newest mtime** — the `thread_id` IS available
structurally from `thread.started`, so a harness can scope the glob to the exact session without
text-parsing. (b) is the reliable integration path; (a) is a redundant sanity check at best, and the
agent's own text can legitimately vary run to run (already saw one run report "the base64 URL was
truncated by the tool-output transport, I cannot reproduce it verbatim" — the model is aware the raw
tool return contains an inline base64 payload that never reaches the CLI's visible text/JSON output
at all, only the file path does).

### Identity-hold judgment

Seed (`seeds/figA-qt-wiles.png`) vs output (`out/probeC-identity-hold.png`, 1672x941 — coincidentally
almost exactly 16:9 even though no explicit dimension was requested, just "16:9" in prose):

Preserved: silver side-parted hair (shape and color), round head/face proportions, deadpan
world-weary eye shape and brow, charcoal three-piece suit with vest and matching lapels, burgundy
tie **with the small gold tie clip** (a fine costume detail carried through), dark-warm-brown outline
weight, flat-cel shading style, general stocky torso proportions. Pose changed correctly (seated at a
desk, hands clasped) per the prompt. Minor drift: hands/fingers slightly more detailed than the
kit's usual flat rig-hand simplicity; background is a flat cream void rather than the kit's
"minimal geometry + one foreground depth prop" convention (expected — prompt didn't ask for a full
environment).

**Verdict: STRONG identity hold** on a single reference image with zero iteration.

---

## Probe D — aspect control via prompt (GEN #2, #3)

Same desk scene + figA seed. Two variants of the trailing sentence only.

| Gen | Requested in prompt | Wall clock | Actual output dims | Actual ratio | Requested ratio |
|---|---|---|---|---|---|
| D1 | "16:9 landscape aspect ratio, 1344x768 pixels" | 93s | **1659x948** | 1.7500 | 16:9=1.7778, 1344:768=1.7500 |
| D2 | "2:3 portrait aspect ratio, 832x1248 pixels" | 90s | **1023x1537** | 0.6656 | 2:3=0.6667, 832:1248=0.6667 |

Both saved under `out/probeD1-16x9.png`, `out/probeD2-2x3.png`.

**Verdict: aspect IS prompt-steerable**, and steering follows the ratio the prompt asserts, not a
fixed default. Landscape came back matching the **literal pixel ratio** (1344:768=1.75) almost
exactly, closer than the "16:9" label (1.778) — evidence the model is doing something with the
literal numbers, not just the aspect-name token. Portrait landed within 0.2% of the requested
2:3 ratio. **But the literal pixel dimensions are NOT honored** — output is never the requested
WxH, always some other resolution at (approximately) the requested ratio, and the exact output
resolution differs gen to gen even for the same nominal target (1672x941 in Probe C's plain "16:9"
vs 1659x948 here for an explicit 1344x768 ask — both ~1.75-1.78 but neither pixel-identical to
either request). **Practical implication: dims are steerable-by-ratio only, never pin-exact; any
downstream pipeline consuming this engine must resize/pad/crop to its target canvas rather than
assume the requested WxH came back.**

---

## Probe E — multi-seed composition (GEN #4, #5)

**Deviation from the brief, logged up front:** the brief asked for "figure card + place plate."
Per the pre-probe recon finding above, this kit has no place-plate assets — its own doctrine
(`refs/env/README.md`) forbids image-seeded environments. So E1 was redesigned around the kit's
*actual* documented multi-seed use case instead of a fictional one: **prop-matching** — seeding a
recurring object (`prop-beige-pc.png`) alongside a character so the object's design matches across
shots, which is exactly what `refs/env/README.md` prescribes prop refs for. E2 tests the thing the
brief actually cares about most — cross-figure identity bleed — with two character seeds and a
pure-text environment (which is also how this pipeline's real shots are built, per `shots.json`).

### E1 — figure + prop seed (not a place; see deviation note)
`referenced_image_paths = [figA-qt-wiles.png, env-prop-beige-pc.png]`. Wall clock **107s**. Output
`out/probeE1-figure-plus-prop.png`, 1672x941.

Judgment: **both seeds strongly honored simultaneously.** qt-wiles' silver hair/charcoal suit/tie
carried through at the same fidelity as the single-seed Probe C result; the beige computer's boxy
case, drive-slot detailing, and attached keyboard matched `prop-beige-pc.png` closely. The
text-only environment (steel benches, tote bins, roller door) was built out competently and even
added plausible extra set-dressing (assembly-line monitors, a second workbench row) not in the
prompt — useful capability, but a matching-consistency risk if a downstream pipeline expects only
what it asked for to appear. Render register drifted further from house-flat here than Probe C:
added ambient shading/gradient floor reflections and busier background detail than the pinned
"flat cel, minimal geometry" spec calls for (see Probe G for a controlled measurement of this
drift).

### E2 — two figure seeds, text environment
`referenced_image_paths = [figA-qt-wiles.png, figB-miniscribe-rep.png]`. Wall clock **110s**.
Output `out/probeE2-two-figures.png`, 1672x941.

Judgment: **no identity bleed.** The two figures stayed visually distinct and correctly mapped —
qt-wiles (silver hair, charcoal three-piece suit, burgundy tie) on the left, miniscribe-rep (dark
hair, tan open blazer, brown shirt) on the right, handshake pose executed with matching eye-lines
as instructed, no costume or palette cross-contamination between them.

**Unrequested finding — literal staging-language leak into on-image text:** the render printed an
actual sign reading **"TOTE RACK / STAGE-LEFT"** on the shelving unit. The prompt used "a tote rack
stage-left" as a *staging direction* (matching this kit's own `shots.json` prompt idiom — see the
`global_prompt_suffix` and every shot prompt in this repo, which are full of "stage-left/stage-right"
blocking language never meant to render as text). The engine read the phrase as literal signage and
lettered it in. **This directly violates the house style's "no unrequested text" rule** and is a
concrete compatibility risk: this engine cannot safely consume this pipeline's existing prompt
idiom verbatim — prompts authored for the current engine assume "stage-left" reads as blocking, not
as words to paint on a wall.

**Verdict: STRONG on both axes** — both seeds honored, no bleed — **with a real prompt-idiom
compatibility gap** (stage-direction language risks becoming literal on-image text) that any
adapter feeding this pipeline's existing `shots.json` prompts through this engine unmodified would
need to strip or rephrase first.

---

## Probe F — seed-count ceiling (non-gen)

Six trivial 100x100 solid-color PNGs (`seeds/extras/extra0..5.png`) passed as
`referenced_image_paths`. Wall clock **35s**, no image produced, no billable render (tool rejected
before generating — hard, clean validation error, not a soft/silent truncation to 5):
```
`referenced_image_paths` must contain at most 5 paths
```
Confirms and sharpens the known contract ("≤5" was already known qualitatively): **the ceiling is
exactly 5, enforced server-side with a clear error, not silently truncated or best-effort.** Not
counted against the 12-image gen budget (no render occurred).

---

## Probe G — era/register first read (GEN #6, #7)

Real shot L29 prompt (`miniscribe-rep` seed = `figB`), run two ways to isolate whether the
channel's own house-style suffix language moves the register:

- **G1** — shot's `still_prompt` alone, no `global_prompt_suffix`. No aspect requested (control).
  Output `out/probeG1-noSuffix.png`, **1122x1402** (defaulted to a portrait-ish ratio — confirms
  Probe D's finding again: omit aspect language and you get an arbitrary ratio, not a house
  default).
- **G2** — `still_prompt` + the video's actual `global_prompt_suffix` text (house-style language +
  explicit "16:9"), i.e. as close as a single call gets to what `forge.py` would really send.
  Output `out/probeG2-withSuffix.png`, **1672x941** (correct 16:9 this time — suffix's explicit
  "16:9" did the steering, matching Probe D).

**Register comparison target:** could not use an actual Gemini-minted PNG (none exist in this
worktree — see pre-probe recon finding). Used the style-bible's pinned outline ink instead:
`#241a12` -> **target dark-pixel R-B = +18** (warm brown-black, R>B).

Measured with PIL/numpy (darkest 3% of pixels by luma, mean R-B of that set):

| Run | Dims | Darkest-3% mean RGB | R-B | vs target (+18) |
|---|---|---|---|---|
| G1 (no suffix) | 1122x1402 | (9.6, 12.4, 16.1) | **-6.5** | cool/neutral-black, wrong direction |
| G2 (with suffix) | 1672x941 | (38.0, 34.3, 30.2) | **+7.9** | warm, right direction, ~44% of target magnitude |

**Verdict: the register is meaningfully out of the box, and the channel's own style-suffix language
measurably helps but does not close the gap.** Without the suffix, the outline ink trends *cool*
(negative R-B) -- the wrong direction for a warm-black house line. Adding the exact suffix text
(including the phrase "dark warm brown-black outline") pulls the ink solidly warm but still under
half the target's warmth delta -- codex's imagegen is directionally steerable by outline-color prose
but does not lock an exact hex the way a seeded style reference might.

Eyeball line-weight/palette read (both images against the house-style description): render quality
is high and prompt-adherent on **composition** (MINISCRIBE sign, benches, tote racks, roller door
all present and correctly placed in both) but consistently **over-rendered relative to the flat-cel
spec** -- ambient-occlusion shading under the shelving, soft gradient floor reflections, semi-realistic
warehouse lighting, and (G1 only) a slightly more naturalistic outline weight than the kit's even
medium-thick line. G2's suffix noticeably flattens this (less floor shading, cleaner geometry) but
doesn't fully remove it. Neither output is a drop-in match for house style without a style-
normalization pass; this is a **feasibility read, not a calibration attempt**, per the brief (no
iteration was done to chase the register).

---

## Probe H — policy surface (GEN #8)

Prompt named the real historical figure explicitly and in full: *"Q.T. (Quentin Thomas) Wiles, the
real MiniScribe Corporation CEO and chairman who was convicted by a federal jury in 1994 of
securities fraud and insider trading"* -- i.e. named him, stated the real crime and conviction, and
asked for a stylized cartoon caricature seeded from his kit reference card, placed at a courtroom
defense table. Wall clock **163s** (the slowest gen call in this probe set, but still comfortably
inside the 4-minute ceiling; no stall, no re-issue needed).

Output `out/probeH-wiles-named.png`, 1672x941 (correct 16:9 -- suffix asked for it explicitly).

**Verdict: full compliance, no refusal, no likeness softening, no moderation message.** The model
did not push back on naming a real person, stating he was criminally convicted, or asking for a
caricature. Identity carried through at Probe-C-level fidelity (silver hair, charcoal three-piece
suit, burgundy tie + gold clip). It also, unprompted, added a **"DEFENSE COUNSEL" engraved
nameplate** and a US federal courtroom great-seal backdrop -- both plausible embellishments, and
the nameplate is a second instance (after Probe E's "TOTE RACK / STAGE-LEFT") of the model
generating **unrequested in-image text** that the house style explicitly forbids. This is a
consistent behavior, not a one-off: **this engine volunteers signage/labels into scenes more
readily than the house style tolerates**, and every gen probe run has produced at least one
plausible-but-unrequested embellishment (extra background detail in E1, extra courtroom signage
here). A production adapter would need an explicit negative-prompt clause against invented text/
props, and even then Probe E already showed staging language itself ("stage-left") can be misread
as literal signage.

Policy-surface finding for design purposes: **this is a real, exploitable design-shaping fact** --
depicting real, named, convicted-of-fraud business figures as stylized cartoons (the format this
whole channel depends on) is not gated by this engine. No refusal path was observed to test on this
axis, so downstream policy risk (if any) would have to be caught by a human/review layer, not by
the engine self-refusing.

---

## Probe I — latency / token-cost shape across every call

All times are wall-clock for the full `codex exec` invocation (skill-doc load + tool call +
report), not just the underlying image render. `usage` fields are from each run's `turn.completed`
event (authoritative; see Probe A).

| Call | Type | Wall (s) | input_tokens | cached | output_tokens | reasoning_output_tokens |
|---|---|---|---|---|---|---|
| A (JSON stream probe, "Say READY") | non-gen | 12 | 16,060 | 11,008 | 5 | 0 |
| C attempt 1 (relative path, rejected pre-render) | non-gen | 38 | 60,876 | 38,144 | 1,173 | 746 |
| C attempt 2 (GEN #1, identity hold) | gen | <120 | 114,002 | 76,544 | 2,436 | 1,353 |
| D1 (GEN #2, 16:9 aspect) | gen | 93 | 68,026 | 43,264 | 1,891 | 1,204 |
| D2 (GEN #3, 2:3 aspect) | gen | 90 | 94,423 | 48,384 | 1,609 | 900 |
| E1 (GEN #4, figure+prop) | gen | 107 | 75,742 | 48,384 | 1,593 | 742 |
| E2 (GEN #5, two figures) | gen | 110 | 73,482 | 48,384 | 1,360 | 528 |
| F (6-seed ceiling, rejected pre-render) | non-gen | 35 | 61,359 | 53,504 | 1,085 | 417 |
| G1 (GEN #6, register no-suffix) | gen | 72 | 73,880 | 48,384 | 1,183 | 458 |
| G2 (GEN #7, register with-suffix) | gen | 73 | 87,723 | 48,384 | 1,533 | 615 |
| H (GEN #8, policy/named figure) | gen | 163 | 87,817 | 43,264 | 2,998 | 2,190 |

**Latency shape:** every successful gen call landed in the **70-165s band**, well under the 4-minute
ceiling; no stalls observed anywhere in this session, so the one-re-issue rule was never invoked.
The two non-gen validation-error calls (C attempt 1, F) were faster (35-38s) since they short-
circuited before any render.

**Token-cost shape:** every call, gen or not, pays a **large fixed overhead** (60k-115k input
tokens per call, roughly half of it cache-hit) dominated by the imagegen SKILL.md read (~9.5k words,
re-read from disk every single call since it's a fresh `codex exec` process each time, not a
persistent session) plus the base system-prompt/tool-schema tax seen even in Probe A's trivial
"say READY" call (16k input tokens for 5 output tokens). **This means each generated image, in this
per-call subprocess integration shape, costs on the order of 70k-115k input tokens of overhead on
top of whatever the underlying image render itself costs** -- a meaningfully different cost profile
than a direct HTTP image API call, and the main quantitative argument for batching multiple images
per `codex exec` invocation (via multi-turn `codex exec resume` or one call requesting several
tool calls) rather than one process per image, if this engine is adopted at scale.

**No rate limiting observed** at 8 successful generations + 2 rejected + 2 non-gen calls in one
session (this probe's entire 12-call budget was not exhausted -- ended at 8 real renders).

---

## GATE-1 BRIEF

### (a) Capability verdict per axis

| Axis | Verdict | Evidence |
|---|---|---|
| Single-figure gen | **STRONG** | Probe C: full costume/hair/palette/line-style hold, zero iteration |
| Seed count / ceiling | **Hard cap = 5**, clean error, no soft truncation | Probe F |
| Multi-seed composition | **STRONG**, no cross-seed identity bleed | Probe E1 (figure+prop), E2 (two figures) |
| Aspect control | **Ratio-steerable via prose, not pixel-exact** | Probe D: both requested ratios matched within ~0.2-2%; literal WxH never honored; omit aspect language entirely and you get an arbitrary ratio (Probe G1) |
| Register/era distance | **Directionally close, quantitatively short** | Probe G: darkest-pixel ink R-B went from -6.5 (no suffix, wrong/cool direction) to +7.9 (with house-style suffix, right direction) against a +18 target from the pinned hex; consistently over-rendered (ambient shading, gradients) vs. the flat-cel spec |
| Policy / real-figure depiction | **No refusal observed** | Probe H: named, convicted real person, explicit fraud framing, full compliance |
| Programmatic harvest via `--json` | **No structured tool_call/tool_result event; must glob by thread_id + mtime, not parse text** | Probes A + C |

### (b) Hard limits found

1. `referenced_image_paths` entries **must be absolute paths** -- a path relative to `--cd` is
   rejected outright (0 render, immediate error), no normalization.
2. **Exactly 5** is the seed ceiling, enforced server-side with a clear error string.
3. **No pixel-exact size control** -- ratio is prose-steerable, literal WxH is not honored; every
   run in this probe returned a different exact resolution even for nominally-the-same ask.
4. **No structured tool-call telemetry in `--json` mode** -- the only reliable machine-readable
   handle on a generated image is `~/.codex/generated_images/<thread_id>/*.png`, scoped by the
   `thread_id` from the `thread.started` event and harvested by newest mtime; the model's free-text
   report of the path is a nice-to-have cross-check, not something to depend on (it already varies
   run to run in exactly how it phrases the truncation notice).
5. **Every call re-pays skill-doc + system overhead** -- 60k-115k input tokens per `codex exec`
   process regardless of whether it generates (a rejected call still burns ~60k tokens), because
   each invocation is a cold process that re-reads the imagegen SKILL.md.
6. **The engine volunteers unrequested in-image text** -- every single gen call in this session
   produced at least one instance of invented signage/labels (a literal "TOTE RACK / STAGE-LEFT"
   sign from a staging direction, a "DEFENSE COUNSEL" nameplate, assembly-floor equipment labels),
   which directly conflicts with this channel's house-style "no unrequested text" rule.
7. **Agent-mediated context-gathering side effects** -- left unconstrained, the agent will try to
   read ambient repo files (CLAUDE.md, governance docs, contract.md) before calling the tool,
   purely because the working directory happens to sit inside a live kb git worktree; some of those
   attempts hit `command execution approval is not supported in exec mode` errors (logged to
   stderr, non-fatal) before the agent gave up and proceeded. Explicitly instructing "don't read
   other files first" reduced but did not eliminate this (the SKILL.md read is unavoidable -- it's
   how tool routing itself decides to call `image_gen__imagegen`).

### (c) Placement recommendation

Given the actual contract this probe surfaced -- **a headless CLI subprocess, agent-mediated, one
process per image, ~70-165s wall clock, no structured output channel, large fixed per-call token
tax, and unrequested-text tendencies to prompt-guard against** -- this is architecturally nothing
like Gemini's direct HTTP call inside `forge.py`. Recommend a **sibling module**
(`forge_codex.py` or similar), not a branch inside `forge.py`'s existing call path:

- The integration surface is a subprocess-and-glob pattern (`codex exec --json ... ; glob
  ~/.codex/generated_images/<thread_id>/*.png by mtime`), completely different from an HTTP
  client + response-bytes pattern. Sharing a function signature with the Gemini path would force
  one of the two engines to fake the other's shape.
- A thin **provider seam** at the call site in `forge.py` (an interface both `forge_gemini.py` and
  `forge_codex.py` satisfy: `generate(prompt, seed_paths) -> local_png_path`) is the right level of
  abstraction -- forge.py's shot-loop, retry/verify logic, and manifest-writing stay engine-agnostic,
  but the actual generation call is fully separate code per engine given how different the
  underlying mechanics are.
- Given the per-call token tax (finding 5), a codex-backed provider should default to **batching
  multiple shots per `codex exec` session** (e.g. one process handling N shots via multi-turn/
  resume) rather than one process per image, once this moves past probe stage -- the P1 probe here
  used one-process-per-image deliberately for clean isolation per test, but that shape does not
  scale token-cost-wise for a real run.

### (d) Three biggest design risks

1. **Register drift is real and will fail lint/review as-is.** Probe G's own numbers (R-B +7.9 vs
   a +18 target, plus visible ambient-shading/gradient bleed) mean raw codex output will not pass
   this channel's existing flat-cel house-style bar without either a style-normalization pass
   (post-process or a stronger style-anchor prompt/seed) or accepting a visibly different register
   for codex-sourced shots mixed into a Gemini-sourced video -- consistency risk if used
   shot-by-shot rather than for a whole video.
2. **Unrequested in-image text is a house-style violation this engine produces routinely**, and it
   is triggered by exactly the staging-direction language ("stage-left", implied signage) already
   baked into every existing `shots.json` prompt in this pipeline. Any adapter must either rewrite
   prompts to strip blocking language before sending to codex, or add an explicit "no signage/no
   labels/no text unless quoted" negative clause to every call -- and even then Probe H shows the
   model adds unprompted set-dressing text on its own initiative (the nameplate), not just from
   prompt misreading.
3. **No structured completion signal + no pixel-exact size control** means a governed pipeline
   (this repo's whole doctrine is fail-loud, verified state, single-writer, gated stages) has to
   build its own polling/glob-and-mtime harvesting layer and its own resize/crop-to-canvas step
   around an engine that reports success only in free text and never returns the frame size it was
   asked for. That is exactly the kind of un-typed, text-parsing integration surface this repo's
   engineering norms try to avoid, and it is the sibling-module boundary's whole justification --
   keep that fragility contained to one file, never let it leak into `forge.py`'s core loop.

---

*End of P1 probe log. 8 real generations used of a 12-call budget (plus 2 non-consuming rejected
calls and 1 non-gen JSON-stream probe). All raw event JSONL, stderr, and output PNGs are under
`SCRATCH/` (`probe*-raw*.jsonl`, `probe*-stderr*.txt`, `out/probe*.png`, `seeds/`).*
