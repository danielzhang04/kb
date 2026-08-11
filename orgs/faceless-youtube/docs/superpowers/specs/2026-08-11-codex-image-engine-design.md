# codex CLI as a second image engine — design (v2)

**Date:** 2026-08-11 (v2 same day, after ruling 7 + the P2b prompting research) ·
**Skill:** `.claude/skills/image-generation` · **Test bed:**
`channels/the-second-take/videos/2026-07-28-bricks-fresh` (kit read-only, outputs to arc staging) ·
**Status:** Daniel-ruled; this is the implementation plan.
**Trigger:** P1 capability probe (`scratch-codex-image-engine/p1-probelog.md`, 8 gens) established
that `image_gen__imagegen` holds figure identity, composes multi-seed scenes without bleed and
depicts named real people — but was out of register and minted unrequested text. P2b prompting
research (`scratch-codex-image-engine/p2b-prompting-research.md`, 9 gens) then established *how to
speak to it natively*, which changed the architecture: the codex path composes its own prompts
rather than adapting Gemini's.

**Daniel's rulings, all integrated below:**
1. **Sibling module, widened** — the codex side owns codex-specific generation doctrine, not just
   transport (§3).
2. **Mixed engines per-shot allowed in v1** — now realized as *split runs over one slate* (§2.2).
3. **Post-processing the register is forbidden** — steer the engine or park it (§7.3).
4. **Register floor `M1 ≥ +15`** — ratified under the pinned-hex framing that P2b has since refuted;
   **needs re-ratification in paired form** (§7.4, §9.2).
5. **Full peer engine for any shot class**; routing is taste/A-B, never a cheap-bulk lane (§1).
6. **Quota = soft cap + ledger, no enforcement** (§5.3).
7. **THE CODEX PATH IS STANDALONE.** Zero `forge.py` edits in v1: `git diff forge.py` must be empty.
   `forge_codex.py` is its own runner with its own CLI, importing `forge.py` read-only as a library.
   Other terminals are live on the Gemini path, so "does not affect Gemini at all" holds **by
   construction**, not by regression test (§2.5, §3).

Ground truth: `p1-probelog.md` + `p2b-prompting-research.md` (empirical), `forge.py` + the skill's
`SKILL.md` (current doctrine), and codex's own tool skill at
`C:/Users/danie/.codex/skills/.system/imagegen/SKILL.md` (+ `references/prompting.md`) — the document
codex itself consults before every call, which supersedes web guidance where they differ. Every
integration claim cites a line; every decision names the alternative rejected; thin evidence is
flagged **[THIN]** rather than smoothed over. Line citations are against
`orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py` (2608 lines) and
`.../image-generation/SKILL.md` unless another file is named.

**What changed from v1:** the codex path became a standalone runner (§2, §3, §8, §10); the prompt
path became a **composer** producing codex-native labeled-field prompts instead of adapted Gemini
prose (§4.1-4.3); verbatim pass-through is now a verified mechanism with a post-hoc audit channel
(§4.4, §4.6); the sandbox choice inverted (§4.4); the register study moved from a pinned-hex target
to **per-shot paired distances** (§7); the unrequested-text risk moved from *untested mitigation* to
*evidence-backed mitigated* (§9.1). The in-process integration design v1 specified is preserved, not
discarded, in §10.

---

## 1. Goal + non-goals

**Goal.** Make codex CLI's `image_gen__imagegen` a **peer generation engine** for the
`image-generation` pipeline — subscription-billed, $0 API spend — usable for **any shot class** at
equal register once calibrated, without re-authoring `shots.json`, the staging discipline, the review
gate or the manifests, and **without touching the Gemini path at all**. Success condition:

```
py -3 .claude/skills/image-generation/scripts/forge_codex.py gen \
      --kit <kit> --batch <spec.json> [--shots L26,L29] [--dry-run]
```

consumes the *same* batch spec `forge.py batch` already emits, stages PNGs into the *same*
`<kit>/_staging/` under the *same* lock/publish discipline, and hands them to the *same* fresh-eyes
review and `stamp_review.py` flow — while `git diff .../forge.py` stays empty and a bounded study
reports, in numbers, whether codex clears a peer-register bar (§7).

**Non-goals.** Not a replacement for Gemini: `gemini-3-pro-image` remains the pipeline's default
engine and its code path is untouched. Not a cheap-bulk lane — codex is never scoped to "plates and
inserts only"; if it cannot hold the register for cast work it is parked, not demoted. Not a quality
promise: the study is bounded, measured, and may end in "park it". Not an in-process engine
abstraction — the provider seam, per-item engine field and engine-aware slate building are designed
and **deferred to Wave 2** (§10). Not a `shots.json`/doctrine rewrite: authored shot prose, the
seeding law, review states and the one-surgical-retry law are inherited unchanged; where codex
cannot satisfy an existing law (the 1K render instrument, §4.6) it is written down as a known
difference, never silently redefined. No new credential of any kind enters the pipeline.

---

## 2. How a codex run is launched (standalone)

### 2.1 Two runners, one file contract

```
shots.json ──► forge.py batch (dry, $0, UNCHANGED) ──► spec.json  (the slate: names, seeds,
                                                        seed_roles, payload, aspect, size)
                                    │
                    ┌───────────────┴────────────────┐
                    ▼                                ▼
        forge.py gen --batch spec.json     forge_codex.py gen --batch spec.json
        (Gemini, unchanged)                (codex, new runner)
                    └───────────────┬────────────────┘
                                    ▼
                    <kit>/_staging/<name>.png   (same layout, same locks, same publish)
                                    ▼
            build_review_artifact.py → fresh-eyes pass → stamp_review.py → manifests
```

The two runners share **no process and no code path** — only files: the batch spec, the staging
directory, and the review/manifest artifacts. That is what makes ruling 7 checkable by
`git diff`.

The slate is built by `forge.py batch`, which is **always dry** (CLI L2557: `dry = ... or a.cmd ==
"batch"`; L2555-2556 states the invariant) and therefore never loads a key or reaches an engine. Its
output is engine-neutral shot truth: which figures, place, primitives and props each shot needs, in
role order, under the seeding law. Using it unchanged is what keeps one slate behind both engines —
the property that makes any A/B comparison meaningful.

### 2.2 Operator flows

**All-codex run.** `forge.py batch --kit … --batch shots.json --out spec.json`, then
`forge_codex.py gen --kit … --batch spec.json --dry-run` (prints every composed prompt at $0), then
the same command without `--dry-run`.

**Mixed video (ruling 2) = split runs over one slate.** Build **one** spec, then run each engine over
its own subset by shot id:

```
forge.py       gen --kit K --batch spec.json                 # every shot NOT listed below
forge_codex.py gen --kit K --batch spec.json --shots L26,L33 # the codex subset
```

- `forge_codex.py --shots <ids>` filters the spec it consumes; forge.py has no such filter on `gen`,
  so the Gemini half is run either from a spec built with `batch --shots` (the existing opt-in repair
  scope, L2527-2530) or simply run first over the whole spec with the codex shots' outputs already
  staged — **skip-if-exists** (`_existing_staging_png`, L997-1007, honoured by `preflight_batch`
  L1154-1155) then makes forge.py skip them without a call. Both orders are safe; the second needs no
  second spec. **Pinned so it reads one way: run codex first, then Gemini over the same spec.**
- No lock collision: reservations are per output name (`_reserve_staging_output`, L1092-1118) with an
  exclusive PID-owned sidecar, and the two runners use the same mechanism on disjoint names.
- Per-frame provenance: the codex runner writes an engine-log row per frame (§5.3); the orchestrator
  copies `engine` onto each scenes-manifest entry when it builds the manifest spec. `cmd_manifest`
  validates only required keys and passes the rest through (L2433-2442), so this needs no forge.py
  change — but per "prove, then register, then emit" the key is registered in the scenes-manifest
  schema doc before a producer emits it.
- **Review carries the register-consistency burden** for a mixed video: no mechanism refuses a mixed
  slate, and the fresh-eyes style/taste axis (SKILL.md L377-379) plus the human board are the only
  guards against two registers inside one cut (§9.1.2).

### 2.3 No key, by construction

`forge_codex.py` builds its Kit as **`Kit(kit_path, dry=True)`**. Read L316-322: the dry branch sets
`self.key, self.url, self.ctx = "", None, None` and skips `load_env(...)["GEMINI_API_KEY"]` entirely,
while everything the codex path actually needs — the style bible's blockquote descriptors
(L307-311), the registry (L312), `self.staging` (L306), `resolve_seed` (L341-348), `use_video`
(L324-329) — is loaded identically. Two properties follow:

1. **The codex runner never reads `.env` and never holds a Gemini key** — the credential ceiling is
   satisfied by construction, and codex itself needs no key (it authenticates through the operator's
   existing CLI session, which the pipeline never reads, prints, copies or persists).
2. **It cannot call Gemini even by mistake**: `k.url is None`, so `nano()` has no endpoint to reach.

Alternative rejected: adding a `no_key=True` parameter to `Kit` to express intent more clearly —
that is a forge.py edit, which ruling 7 forbids, and `dry=True` already means exactly this.

### 2.4 `forge_codex.py` CLI surface

| Command / flag | Meaning |
| --- | --- |
| `gen --kit <dir> --batch <spec.json>` | Consume a `forge.py batch` spec; generate every item. |
| `--shots L26,L33` (repeatable) | Consume only these item names (the split-run filter, §2.2). |
| `--dry-run` | Compose every prompt, print it in full, resolve and validate every seed, run the seeding-law preflight — **zero subprocesses, zero images** (mirrors `gen --dry-run`'s contract, SKILL.md L162-164). |
| `--force` | Same semantics as forge's `--force`: overwrite a staged survivor. |
| `--session-mode isolated\|session` (default `isolated`) | §5.2. |
| `--session-span N` (default 8) | Turns per session before a fresh thread (§5.2). |
| `--canvas 1K\|2K` (default from the spec item's `image_size`, else `1K`) | Normalization target (§4.6). |
| `--keep-composed` | Keep the composed prompt files after the run (default: kept under `<kit>/_staging/_codex/prompts/<name>.txt`, since they are the audit trail). |

Deliberately **not** offered: `--engine` (this runner is the codex engine), a per-item engine field
(Wave 2, §10), and any flag that would make forge.py behave differently.

### 2.5 The guarantee: forge.py untouched, by construction

| Claim | How it is held |
| --- | --- |
| Gemini behaviour is bit-identical | `forge.py` is not edited. The acceptance check is `git diff --exit-code .../scripts/forge.py`, run in CI-style at P5 sign-off — a mechanical check, not a test suite's opinion. |
| No new import risk into forge.py | forge.py does **not** import forge_codex; the dependency is one-directional (forge_codex → forge). |
| No new files in a Gemini run | Everything the codex path writes lives under `<kit>/_staging/_codex/` plus the staged PNG itself; a Gemini run creates none of it. |
| No shared mutable state | The two runners touch the same staging directory only through forge's own reserve/publish primitives (§3.2). |
| Import safety | Verified: `forge.py`'s module top level is a docstring, imports, constants and `def`/`class` statements only, with `main()` guarded by `if __name__ == "__main__":` (L2606-2607). Importing it opens no file, loads no key, makes no network call (§3.2). |

---

## 3. Placement — standalone runner over an imported library

**Ruled (7): standalone.** `forge_codex.py` owns codex-specific generation doctrine *and* its own run
loop. Daniel's ruling 1 words, still binding on scope: *"seeding law for codex image gen, required
params, logic, what needs to be stressed, and actual run logic may be different."*

**The line, in one sentence: `forge.py` (as a library + the slate builder) supplies WHAT the shot
needs; `forge_codex.py` decides HOW to say it and runs the call.**

### 3.1 The boundary

| Supplied by `forge.py` — shot truth, imported read-only | Owned by `forge_codex.py` — provider truth |
| --- | --- |
| The slate: figures, place, primitives, props, chain parents, role order, `assets_omitted` ledger (`cmd_batch` L1595-1985, run as `batch`, always dry) | The **prompt**: composition from shot facts into codex's native labeled schema (§4.1) |
| Seeding-law refusals: `seeding_law_violations` (L751-941), `seed_role_violations` (L651-713), `resolve_request_seeds` (L943-975), `verify_request_seed_digests` (L1021-1029) — reused via `preflight_batch` (L1146-1164) | The **seed cap it enforces when consuming a spec** (§4.7) and any extra register seeds it adds within that cap |
| Bytes discipline: `validate_png` (L118-125), `to_png_bytes` (L100-116) | Harvest, fidelity audit, normalization to canvas (§4.6) |
| Staging discipline: `_staging_png` (L982-994), `_existing_staging_png` (L997-1007), `_reserve_staging_output` (L1092-1118), `_publish_staging_png` (L1121-1143), `_release_staging_lock` (L1032-1038) | The exec invocation, session mode, failure classification, transport re-issue (§4.4, §5.2, §6) |
| Kit + registry + bible reading (`Kit`, L293-361) | The engine log, the composed-prompt archive, the cost totals (§5.3) |
| Downstream: `build_review_artifact.py`, `stamp_review.py`, `cmd_manifest` (L2405-2456), the three review states, the one-surgical-retry law | Nothing downstream — the codex runner stops at "a validated PNG is published into staging" |

### 3.2 Imported symbols, and their import-safety audit

```python
from forge import (Kit, preflight_batch, resolve_request_seeds, verify_request_seed_digests,
                   validate_png, to_png_bytes, SeedIntegrityError, SEED_CAP,
                   _staging_png, _existing_staging_png, _reserve_staging_output,
                   _publish_staging_png, _release_staging_lock, _stem)
```

- **Import safety verified** (the ruling requires this check): forge.py's module top level contains
  only its docstring, `import` statements, constants (`IMAGE_SIZES` L55, `SEED_CAP` L381,
  `LOCK_STALE_SECONDS` L978, compiled regexes L195/L979, `STYLE_TILE` L413, `LETTERING_EXEMPLAR`
  L399…), and `def`/`class` definitions; `main()` runs only under
  `if __name__ == "__main__":` (L2606-2607). No network call, no `.env` read, no filesystem write
  happens at import. The key load lives inside `Kit.__init__` (L320) and is skipped by `dry=True`
  (§2.3).
- **Private names are imported deliberately.** `_reserve_staging_output` / `_publish_staging_png` /
  `_release_staging_lock` are the *only* correct way to write into staging: the exclusive PID-owned
  sidecar lock, the atomic non-clobbering `os.link` (L1134) and the escape check (L1125-1127) are
  what make two runners safe against each other. Reimplementing them in forge_codex would be a
  second, divergent writer of the same directory — exactly the failure the single-writer discipline
  exists to prevent. **Alternative rejected:** copying the functions into forge_codex (an
  independent copy silently drifts the moment forge.py's locking changes).
- **The coupling is made loud, not silent.** `test_forge_codex.py` carries an **import-surface
  contract test** asserting every imported symbol exists and takes the expected arguments, so a
  future forge.py refactor breaks the codex tests with a clear message instead of corrupting staging
  at runtime (§8.2 case 1).

### 3.3 The runner's internal seam

Inside `forge_codex.py` the generation call is still a function, so tests can drive it without a
subprocess:

```python
def generate(*, prompt_path: str, seeds: list[str], canvas: tuple[int, int],
             name: str, session=None) -> tuple[bytes, dict]:
    """Invoke codex on an already-composed prompt FILE; return (validated PNG bytes, metadata)."""
```

- Takes a **prompt path**, not prompt text: the verbatim mechanism *is* a file on disk (§4.4), so the
  seam's unit of work is the file the composer wrote.
- Returns **bytes**, so publication flows through forge's `_publish_staging_png` unchanged (one
  writer of staging, §3.2).
- `canvas` is explicit `(W, H)`; aspect/size resolution happens in the composer, not here.

### 3.4 File layout

```
scripts/forge.py             UNCHANGED (git diff must be empty)
scripts/forge_codex.py       NEW ~600-750 lines: CLI + run loop, composer, invocation, harvest,
                             fidelity audit, normalization, failure classification, engine log.
scripts/test_forge_codex.py  NEW — unit tests + the fake-binary fixture (§8).
```

`forge_codex.py` does `sys.path.insert(0, str(Path(__file__).parent))` before `import forge`, the
same convention the existing test files use (`test_forge_hold.py` L6-7), so the sibling import
resolves identically from the CLI, from tests and from a subagent's cwd.

---

## 4. Request path

Per item: **compose prompt → write prompt file → resolve/verify seeds → invoke → harvest → fidelity
audit → validate → normalize → publish via forge's staging primitives → log row.**
`preflight_batch` runs over the whole (filtered) spec first, at $0, exactly as the Gemini path does.

### 4.1 The composer — the primary prompt path

**v1 adapted the assembled Gemini prompt. That is superseded.** P2b measured the ported Gemini prompt
(its "format 1") as the *worst* of three shapes on this engine — furthest from the same-shot Gemini
baseline (+8.0 vs a real +0.5) with visible ambient shading — while both codex-native shapes beat it
2-3×. So the codex path **composes its own prompt from shot facts** in codex's own labeled schema
(`~/.codex/skills/.system/imagegen/SKILL.md` L212-229, quoted in §4.2), which is the schema codex is
itself instructed to normalize prompts into.

**Inputs (all structured, all already validated):**

| Input | Source | Used for |
| --- | --- | --- |
| `item["payload"]` | the batch spec (`cmd_batch` L1927-1928) — the **authored** shot prose, before role prose is prepended | `Primary request:` verbatim |
| `item["seed_roles"]` | the spec, `{path, role, character}` in final provider order | `Input images:` short ordinal labels |
| `item["aspect"]`, `item["image_size"]` | the spec | `Composition/framing:` + the normalization canvas |
| `item["figures"]` | the spec (`{"crowd": true}`) | the crowd line in `Constraints:` |
| quoted literals inside `payload` | regex over the authored prose (SKILL.md L136-138: all in-video text is diegetic and quoted, 1-4 words) | `Text (verbatim):` and the text half of `Avoid:` |
| registry descriptors | `Kit.reg` (L312), `merge_vocabulary` via `use_video` (L324-329) | resolving backticked cast slugs to plain names |
| `CODEX_REGISTER_BLOCK` | a registered constant in forge_codex, sourced from the style bible §2b/§5 and the video's `global_prompt_suffix` but **condensed** | `Style/medium:`, `Color palette:`, `Materials/textures:`, `Avoid:` |

**Determinism is a hard requirement**, not an aspiration: the composer is a pure function of
(spec item, registry, canvas, constants). No model call, no randomness, no ambient state. That is
what makes `--dry-run` print the exact bytes that a live run would send, at $0, and what makes a
composed prompt reproducible from the spec months later.

**Field mapping rules (each field has exactly one source; a field with no source is omitted).**
Omission matters: P2b measured that bloat holding facts constant is ~6× worse (its E1: 1740→4032
chars moved M1 from +4.6 to +29.1), so duplicating a fact across two fields is a measured harm, not
a belt-and-braces.

- `Use case:` / `Asset type:` — fixed constants for this channel (`illustration-story` /
  `documentary-style animated video still frame`).
- `Primary request:` — `item["payload"]`, backticked slugs resolved to plain names, run through the
  idiom translation (§4.3). **Verbatim otherwise**, which is what preserves surgical-retry semantics
  (below).
- `Input images:` — one short clause per seed role, ordinal + role + (for a figure) the character
  name: *"Image 1: character reference for Q.T. Wiles — match exactly. Image 2: prop reference —
  include exactly as shown. Image 3: style reference only."* P2b probe D: all three tested framings
  (bare ordinal, content-descriptive, verbose explicit-forbid) prevented style-tile content leak
  equally, including the cheapest; verbosity is **not** protective, so the composer uses the short
  form. Role wording is derived from the same `role` values forge already assigns (`seed_roles_text`
  L1270-1352 is the source of truth for *what each role means*; the codex composer restates it
  short).
- `Style/medium:`, `Color palette:`, `Materials/textures:` — from `CODEX_REGISTER_BLOCK`.
- `Composition/framing:` — the canvas sentence: *"Compose for a 1376×768 pixel frame — a 16:9
  landscape aspect ratio."* Mandatory on every call: omitting aspect language returns an arbitrary
  ratio (p1 probe G1 got 1122×1402 on a 16:9 shot), while stating it lands within ~0.1-2% across
  every probe in both logs.
- `Text (verbatim):` — the quoted literals, e.g. `"MINISCRIBE" (on the painted board only)`. Omitted
  entirely when the shot quotes none.
- `Constraints:` — the must-preserve half: identity/costume/proportion/line-weight hold for each
  seeded figure, the crowd clause when `figures.crowd`, the built-but-flat environment rule.
  Condensed from the bible's §2c/§2d blockquotes, not pasted.
- `Avoid:` — the negative list, **the single biggest measured lever** (§4.2).

**Surgical-retry semantics, pinned.** SKILL.md L191-202's overlay applies an exact `{from, to}`
replacement to the *authored payload*, and `_retry_scene` carries that edited payload onto the rebuilt
item (`payload = item.get("payload", item["delta"])`, L2127; emitted at L2256). Since
`Primary request:` **is** `item["payload"]` verbatim, a surgical span edit remains a surgical edit to
exactly one field of the composed prompt — the overlay mechanism keeps working with no change to it,
and `batch --retry` (dry, forge.py, unedited) still builds the retry slate. The genlog row records
`composed_prompt_sha256` for the original and the retry, so "one clause changed" is auditable rather
than asserted. **Alternative rejected:** letting the overlay edit the *composed* prompt — that would
require a codex-specific overlay format, forking a doctrine mechanism the Gemini path shares.

### 4.2 Composition doctrine (measured, from P2b)

The codex schema, verbatim from `~/.codex/skills/.system/imagegen/SKILL.md` L212-229:

```text
Use case / Asset type / Primary request / Input images / Scene-backdrop / Subject /
Style-medium / Composition-framing / Lighting-mood / Color palette / Materials-textures /
Text (verbatim) / Constraints / Avoid
```

| Doctrine | Evidence | Consequence for the composer |
| --- | --- | --- |
| **Front-loaded structure, one trailing constraint block** — *not* recency-weighted | Official OpenAI guidance + codex's own `references/prompting.md` L24 ("scene/backdrop → subject → key details → constraints"); P2b E2 measured head+tail repetition **~4× worse** (+2.5 → +10.4) | Fields emit in schema order; the house-style block is stated **once**. Gemini's two-voice head+tail convention (`assemble_prompt` L273-290) is **not** ported. |
| **A dedicated `Avoid:` field is the #1 register lever** | P2b B/C: dedicated Avoid beat the same negatives folded into prose by **2-3×** (+8.0 → +4.6 / +2.5), and every dedicated-Avoid run produced **zero unrequested text** | `Avoid:` is mandatory on every composed prompt, phrased as hard direct negation, short (2-6 items), never merged into `Constraints:` (the schema splits keep/avoid deliberately). |
| **Shorter is better, holding facts constant** | P2b E1: same facts, 1740→4032 chars, **~6× worse** (+4.6 → +29.1), plus more volunteered set-dressing | The composer emits no field it lacks a distinct source for, never restates a fact in two fields, and carries a length budget with a test (§8.2). |
| **Seed roles: short ordinal + role label; verbosity is not protective** | P2b D: zero content leak in all three framings including the one-line ordinal | Short `Input images:` clauses (§4.1). Explicit "do NOT reuse X/Y/Z" language is reserved for a tile that has actually leaked. |
| **Avoid-field and role labels are separate, additive levers** | P2b D: all three role framings, none with an Avoid field, drifted warm (+23 to +43) | Both are mandatory; neither substitutes for the other. |
| **Verbatim pass-through is achievable** | P2b A: byte-for-byte identical across 2 runs via 2 different internal mechanisms, verified against session rollout logs | The composer owns 100% of what the tool sees (§4.4). |

**Canonical worked example** (P2b's best all-round result — its format 2, R−B +4.6 against a
same-shot real Gemini baseline of +0.5 — reproduced here as the composer's target output shape):

```text
Use case: illustration-story
Asset type: documentary-style animated video still frame
Primary request: miniscribe-rep, delighted expression, power-stance pose, planted centre in the
entrance at the back of the MiniScribe assembly floor, a painted board reading "MINISCRIBE"
hanging over him
Input images: Image 1: character reference for miniscribe-rep -- match exact costume,
proportions, and line style
Scene/backdrop: the assembly floor as established -- two long steel benches running back into the
depth, a rack of tote bins at stage-left of frame, a shut roller door beyond
Subject: miniscribe-rep, matching the character reference exactly
Style/medium: clean flat 2.5D vector cartoon, even medium-thick dark warm brown-black outline
(#241a12), flat cel colour fills with gentle soft shading only, rounded friendly shapes, no
realistic detail
Composition/framing: foreground depth from a cropped bench end at lower-right; 16:9 landscape
Lighting/mood: flat strip light, cool grey-teal-cream palette
Color palette: locked 2-3 colour scene palette (cool grey-teal-cream) plus a single red accent
#d7402b reserved only for alarm / prohibition / ownership / the final punch element
Materials/textures: flat cel fills only, no gradients, no ambient occlusion
Text (verbatim): "MINISCRIBE" (on the painted board only)
Constraints: preserve miniscribe-rep's exact costume, proportions, and line weight from the
reference image; environment stays a built-but-flat environment -- minimal geometry plus one
foreground depth prop, not a fully rendered set
Avoid: photorealism, on-screen narrator or host face, unrequested text or signage beyond the
quoted board text, logos, gradients, cast shadows, soft ambient shading, invented staging labels
```

Two notes on reading this example as a spec: (a) its `Scene/backdrop` and `Subject` lines were hand-
split from the shot's prose by a researcher — the production composer instead puts the whole authored
payload in `Primary request:` and omits those two fields unless a distinct source exists, because a
prose-splitting heuristic is neither deterministic nor auditable **[THIN]** — P4 measures whether
that omission costs anything; (b) it still contains the literal word "stage-left", which §4.3
translates.

### 4.3 Idiom translation and the text guard

The authored payload still carries this pipeline's staging idiom, and P1 probe E2 rendered a literal
`TOTE RACK / STAGE-LEFT` sign from it. Live examples in the bricks file today: L46 (*"…in a grey work
coat, stage-left, carrying a cardboard box…"*), L47 (*"…stage-right, stepping out through a glass
door…"*). A fixed, ordered, case-insensitive table runs over the payload **before** it becomes
`Primary request:`:

| Pattern (word-boundary, case-insensitive) | Replacement |
| --- | --- |
| `stage[-\s]left` | `on the left of the frame` |
| `stage[-\s]right` | `on the right of the frame` |
| `stage[-\s](centre\|center)` | `centred in the frame` |
| `up\s?stage` | `toward the back of the frame` |
| `down\s?stage` | `toward the front of the frame` |
| `camera[-\s](left\|right)` | `on the (left\|right) of the frame` |
| `off[-\s]?stage` | `outside the frame` |

Two properties: (a) it never touches text inside quotes — diegetic literals are load-bearing and must
render verbatim (SKILL.md L136-138); (b) it changes wording only, never deleting a staging fact,
because dropping a load-bearing fact to dodge a rendering defect is the fidelity violation named at
SKILL.md L395-397. A **residual scan** then flags any remaining `\bstage\b`/`\bwings\b`/`\bblocking\b`
near a direction word into `residual_idiom` in the log row, printed by `--dry-run`, as a WARN not an
error (the table cannot be proven exhaustive; hard-failing on prose would block legitimate shots).
**[THIN]** — one observed instance; everything past `stage-left/right` is inferred.

**Text control now lives in two fields, not in a bolted-on allow-list paragraph.** `Text (verbatim):`
states exactly what may render; `Avoid:` states *"unrequested text or signage beyond the quoted text,
logos, invented staging labels"*. When the shot quotes nothing, `Text (verbatim):` is omitted and
`Avoid:` leads with *"any words, letters, numerals or signage"*. P2b: zero unrequested text in every
dedicated-Avoid run, which is why this replaces v1's separate positive allow-list clause — the
schema's own field does the job with fewer characters, and characters cost register (§4.2).

### 4.4 Invocation: verbatim pass-through, and the sandbox ruling

```
<codex_bin> exec --json --sandbox workspace-write --cd <isolated_tmp_dir> "<envelope>"
   stdin = DEVNULL, timeout = 240s, cwd = <isolated_tmp_dir>, stdout read line-by-line
```

**The composed prompt is written to a UTF-8 file and passed by reference, never inlined.** The
envelope instructs (P2b's verified incantation):

> *"Read the file at `<absolute path>` and pass its exact byte content as the `prompt` argument to
> `image_gen__imagegen`. Do not compose, paraphrase, normalize, or reformat this text — read and pass
> through only. Call the tool exactly once, with `referenced_image_paths = [<absolute paths>]`. Do not
> read any file outside this directory. Report only the saved image path."*

- **Why a file, not inline text:** P2b A verified byte-for-byte pass-through twice, and in the first
  run the model spontaneously chose the *safer* mechanism — code that reads the file and pipes its
  contents into `prompt` as a variable, never re-typing the string. Inline text works too (run 2
  retyped it perfectly) but re-introduces a transcription step for free. This also defeats the
  standing *"if the user's prompt is already specific and detailed, normalize it into a clear spec"*
  instruction in codex's own tool skill (`~/.codex/skills/.system/imagegen/SKILL.md` step 9;
  `references/prompting.md` "Specificity policy") — the model never runs its prompt-authoring
  judgement over text it only references.
- Prompt files are kept at `<kit>/_staging/_codex/prompts/<name>.txt` as the audit trail the fidelity
  check (§4.6) diffs against.
- **Sandbox: `workspace-write`, ruled by measurement, not preference.** v1 specified `read-only` with
  `workspace-write` as fallback. P2b refuted it: `--sandbox read-only` **hung past the 4-minute
  ceiling** (killed at ~7 minutes with 4 live `codex.exe` children and zero bytes written to the
  `--json` stream). It does not fail fast — a silent hang is a worse failure mode than a clean
  rejection. Production uses `workspace-write` **on an empty temp dir**, which grants writes only to
  a directory containing nothing; the image lands in the codex images root regardless, so no write
  permission is needed for the deliverable itself.
- **`--cd` is a fresh `tempfile.mkdtemp()` outside the repo**, removed in a `finally`. This is the
  only plausible full fix for the ambient-repo-read side effect: P2b's rollout log shows one call
  making **24 tool calls before the image call** — reading the tool SKILL.md, this repo's
  `CLAUDE.md` (twice), `orgs/kb-ops/contract.md`, `STATE.md`, `BOSS.md`, `_index.md`, a `memory/`
  listing, a `STOP`-file check, and an attempted execution of `scripts/preamble.py` — costing
  **936,102 input tokens** against a comparable clean call's 114,002 (8×). Adding *"do not read any
  file outside this directory"* cut it to 11 calls / 246,742 tokens (~74% off) but did not zero it.
  **[THIN] — P4 must verify empirically** that an empty temp cwd zeroes the detour; if it does not,
  §5.1's quota math is materially worse than the clean-call numbers suggest.
- **`stdin=DEVNULL`** (p1 probe A saw `Reading additional input from stdin...`).
- **Only proven flags.** `exec --json --sandbox <mode> --cd <dir>` are the flags both probe logs
  actually ran. Any further flag must be probe-verified in P4 before it appears in code.
- **Three module-level constants carry the environment**, so tests can patch them and production has
  no environment-variable override surface (§8.1): `CODEX_ARGV_PREFIX` (default `["codex"]`),
  `IMAGE_ROOT` (default `~/.codex/generated_images`) and `SESSIONS_ROOT` (default `~/.codex/sessions`,
  read only by the fidelity audit, §4.6), plus `TIMEOUT_S = 240`. The binary is resolved by
  `resolve_codex_binary()` **called from the run loop, never at import time**, with a fail-loud
  "codex CLI not found on PATH" error — so importing `forge_codex` for a unit test requires no codex
  installation and performs no side effects.
- **Timeout 240s** = the standing 4-minute ceiling; observed successful band 70-165s across both
  logs. On timeout the child is killed **with its whole process tree** — P2b's hung run left 4 live
  `codex.exe` children, so a single-PID kill is insufficient (Windows: `CREATE_NEW_PROCESS_GROUP` +
  `taskkill /T /F`; POSIX: `killpg`) — and the call is classified `stall` (§6).

### 4.5 Seeds

- Seeds come from `resolve_request_seeds` (L943-975), which already returns absolute paths
  (`k.resolve_seed` L341-348 joins the absolute `k.root`/`k.kit`). The runner still applies
  `os.path.realpath()` and asserts `os.path.isabs`: p1 hard limit 1 is a **pre-render hard rejection**
  with no normalization (`AbsolutePathBuf deserialized without a base path`), so the assert costs
  nothing while the rejection costs a full cold-process round trip.
- **Transport ceiling assert:** `len(seeds) <= 5`, fail-loud, naming the shot (p1 probe F: exactly 5,
  server-enforced, clean error, no silent truncation). Structurally separate from the doctrine cap
  (§4.7).
- **Digests:** `verify_request_seed_digests` (L1021-1029) runs inside `preflight_batch`; the runner
  re-hashes each seed immediately before invoking and raises `SeedIntegrityError` (L85-87), aborting
  the remaining batch. **Known gap:** the Gemini path closes the TOCTOU window by reading checked
  bytes *into* the request (`ip()` L90-95); a path-based tool contract cannot — the codex process
  opens the file at an unknown later moment. Mitigation: every seed's sha256 is recorded in the log
  row so a post-hoc audit can detect a mid-run change. Not closeable from our side.

### 4.6 Harvest, fidelity audit, validation, normalization

**Harvest (fail-loud, snapshot-diff).**
1. Before invoking, snapshot `set(os.listdir(IMAGE_ROOT/<thread_id>))` — empty for a fresh thread,
   non-empty for a resumed session (§5.2), which is why this is a diff and never "the only file".
2. Read the JSONL stream line by line; capture `thread_id` from `thread.started` and `usage` from
   `turn.completed`. `thread_id` is the only structural handle: there is no `tool_call`/`tool_result`
   event (p1 hard limit 4).
3. After `turn.completed`, diff again with a bounded poll (5 × 1s) for write/close lag.
4. **Exactly one new `*.png`** → success. Zero → `no_image` (§6). More than one → `multi_emit` (§6):
   take none, fail loud, list the paths. **Alternative rejected:** newest-by-mtime wins — it ships
   whichever candidate finished last, and 17 gens across both logs never produced a second image, so
   there is no evidence about what a second one *means*.
5. The harvested file is **left in place** under `~/.codex/generated_images/`; its path and sha256 go
   into the log row. The runner deletes nothing outside the repo.

**Fidelity audit (new in v2 — a production verification channel, not just a probe technique).**
`codex exec` writes a full session transcript to
`~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<thread_id>.jsonl`, and the `custom_tool_call` item carries
the literal JS the model wrote to invoke the tool (P2b's methodology note; the tool is called from a
model-authored sandboxed JS snippet, not a native structured call). After each gen the runner opens
**only the file matching its own `thread_id`**, and:

- if the call's captured `prompt` value is recoverable — either as a JS string literal in the
  `custom_tool_call` input, or echoed in the `custom_tool_call_output` (P2b saw both shapes) — it is
  compared against the composed prompt file. Equal ⇒ `fidelity_audit: "verified"`.
- Not recoverable (the read-into-variable mechanism leaves no literal, and the output echo is not
  guaranteed) ⇒ `fidelity_audit: "unverifiable"`. This is not a failure: P2b verified pass-through
  byte-for-byte twice, and the mechanism that hides the string is the *safer* of the two.
- **Mismatch ⇒ the frame is published but marked**: `fidelity_audit: "mismatch"` in the log row with
  both shas, a loud stderr line, and the shot named in the run summary so the fresh-eyes pass parks
  it. **Alternative rejected:** silently discarding the image (it may be perfectly good, and the
  reviewer, not the runner, rules on frames) — and equally rejected: treating a mismatch as noise
  (it means the composer did not own what the tool saw, which invalidates every register measurement
  made from that frame).
- The rollout log is read-only, outside the repo, and may contain unrelated sessions; the runner
  opens exactly one file by thread id, extracts two fields, and never copies its contents anywhere.

**Validation.** `validate_png` (L118-125) runs on the harvested bytes *before* normalization —
rejecting ≤1024 bytes and bad magic — and again on the normalized bytes before publication, so
nothing unvalidated reaches `_publish_staging_png`. `to_png_bytes` (L100-116) runs once on the
harvested bytes (a no-op for PNG).

**Normalization to canvas.** Ratio is prose-steerable to ~0.1-2% but pixel dims are never honored and
the same ask returns a different resolution each run (p1 probe D; P2b's three formats all landed
1672×941). Downstream assumes a stated canvas (SKILL.md L121-132):

```
target = CANVAS[(aspect, image_size)]
r_err  = |native_ratio / target_ratio - 1|
r_err > 0.05          -> raise RatioError                 (failure class 7, §6)
0 < r_err <= 0.05     -> centre-crop the excess axis to the exact target ratio
then                  -> Lanczos resize to exactly (W, H), re-validate, publish
```

- Centre-crop-then-resize, never anisotropic stretch: a 2% stretch is invisible on a plate and
  obvious on a face; a ≤5% crop costs a few percent of the frame edge.
- **`CANVAS` is calibrated to real pipeline output:** all 23 verified baseline frames measure
  **1376×768** (`scratch-codex-image-engine/gemini-baseline/`, §7.5), not SKILL.md L130's
  approximate "~1344×768". `(16:9, 1K) = 1376×768`; `(2:3, 1K) = 832×1248` and `(9:16, 1K) =
  768×1344` are carried from the doc until measured **[THIN]**; 2K rows are 2× linear. An
  `(aspect, size)` pair absent from the table is a fail-loud error naming the pair, never a guess.
- **Register consequence, stated not hidden:** SKILL.md L126-132 makes 1K the default *because it is
  the era instrument*. Codex renders at its own ~1.5-1.7 MP regardless of what we ask, so **a codex
  frame is never rendered at the 1K instrument**; downscaling is a post-hoc proxy. Permanent, and
  carried into §7's L3 and §9's risks. (Downscale from ~1.2× is mildly detail-suppressing, which
  pushes *toward* flatness — §7 measures whether that matters.)

### 4.7 Seed cap when consuming a spec built under cap 4

Ruling 1 makes the cap provider-owned; ruling 7 means the codex runner cannot change how the slate
was *built*. The specs it consumes are therefore always fitted to `SEED_CAP = 4` (forge.py L381),
with the ordered displacement walk (L1861-1906) already applied and recorded in each item's `why` /
`assets_omitted`. So:

- **The runner's own cap is a declared constant `CODEX_SEED_CAP`, shipping at 4** — identical to what
  the spec was built under, so v1 behaviour is "consume the slate exactly as built". A slate already
  fits by construction; the runner asserts `len(seeds) <= CODEX_SEED_CAP` and fails loud if a
  hand-edited spec exceeds it (naming the shot), rather than silently truncating — silent truncation
  is the exact 2026-07-28 failure the seeding law was written against (forge.py L1246-1250).
- **If evidence later says codex wants a 5th slot** (§7's L1 lever), the runner cannot *add* a seed
  the slate omitted without re-deriving the slate — and re-deriving is forge.py's job. Two honest
  options, and the spec picks one: **(a)** raise `CODEX_SEED_CAP` to 5 and have the runner add only
  seeds it can derive itself without re-running the walk — specifically the §5 scene style tile,
  which is a fixed kit path and needs no slate knowledge — appending it *after* the slate's seeds and
  recording it in the log row as `added_by: "codex_register_policy"`; or **(b)** wait for Wave 2 and
  do it properly inside `cmd_batch`'s walk. **(a) is authorized only for the study**, where it is
  measured against a fixed corpus; promoting it to production routes through §10's Wave 2, because a
  seed added outside the displacement walk has not competed under the never-droppable floor and that
  is a doctrine property, not a convenience.
- The `assets_omitted` ledger stays exactly as `batch` wrote it; the runner appends to the log row,
  never to the spec.

**The style-tile collision, restated with new evidence.** SKILL.md L139-143 and
`test_forge_style_tile.py` make `refs/env/scene-style-tile.png` a **cast-free-only** derived seed. P2b
probe D materially strengthens the case for testing that boundary on codex: with a *content-rich*
style tile (a full vintage-computer-shop interior with shelving, terrazzo floor, a "1983" placard and
a shopfront window) as a third seed, **all three role framings produced zero content leak** — the
exact failure the cast-free law fears did not occur even under the weakest framing. That is evidence
the lever is *safe to test*, not evidence it helps ink; P2b never isolated ink transfer from the tile
(its D runs had no `Avoid:` field and all drifted warm). §7's L1 tests exactly that.

---

## 5. Batching + cost shape

### 5.1 What a call actually costs

| Call shape | Input tokens | Source |
| --- | --- | --- |
| Clean single-seed gen | 70-115k | p1 probe I (8 gens) |
| Gen with a short scope instruction | ~247k | P2b GEN #2 |
| Gen with no scope instruction, cwd inside a kb worktree | **936k** | P2b GEN #1 (24 pre-call tool calls) |

Billing is **subscription, not metered** — $0 API spend, the arc's premise — so this is not money; it
is rate-limit headroom on the same subscription the fleet's codex workers (dispatch-codex) draw from.
But the spread matters: the ambient-read detour can cost **8× a clean call**, which makes §4.4's
empty temp cwd a cost-control mechanism, not only a boundary control. At peer scale a 246-shot video
is ~17-28M input tokens and 5-11 h wall clock in `isolated` mode *if* the detour is controlled, and
several times that if it is not. **P4 measures the empty-cwd effect before any full-video run is
planned.**

### 5.2 Default: one turn per image; session reuse is the only sanctioned batching

**Default `isolated` — one `codex exec` process per image.** Reasons, in order:
1. The staging reservation (`_reserve_staging_output`, L1092-1118) is per output name and taken
   before the call; N images per process would mean one process holding N locks, and a mid-process
   failure unwinding N reservations.
2. Harvest determinism: "exactly one new PNG" is decidable per turn only. Mapping M PNGs onto M shot
   ids inside one turn means trusting emission order or agent free text — both untrustworthy
   (p1 hard limit 4).
3. Blast radius: one stall loses one frame.
4. The one-surgical-retry law (SKILL.md L384-393) is per-frame.

**Optional `session` — `codex exec resume <thread_id>`, still ONE image per turn.** Process/prefix
overhead amortizes while every invariant above survives. The composer's file-based prompts work
identically per turn: each turn's envelope names its own prompt file, so nothing about verbatim
pass-through depends on the process being fresh. Harvest is a snapshot-diff (§4.6) precisely so a
shared per-thread image directory works unchanged. **[THIN] — never exercised in either probe log**
(P2b open question 6): whether `--json` emits `thread.started` on resume, whether resumed turns write
into the same `<thread_id>` directory, whether the Avoid-field/brevity findings hold across turns in
one context, and the realized saving are all P4 measurements. `session` is implemented but not the
default until P4 reports.

`--session-span N` (default 8) bounds one context's reach; a resume failure falls back to `isolated`
once, automatically, and records the fallback.

**Alternative rejected:** one turn asking for several images — it converts a structural one-new-file
check into an ordering assumption over an agent's free text.

### 5.3 Observability: engine log + composed-prompt archive + cost ledger (ruling 6)

**In code.** One JSONL row per generated frame at `<kit>/_staging/_codex/engine-log.jsonl`:

```json
{"ts":"…","engine":"codex-imagegen","name":"L29","thread_id":"019ff…","turn_index":1,
 "session_mode":"isolated","wall_s":107.4,"tokens_in":75742,"tokens_cached":48384,
 "tokens_out":1593,"reasoning_out":742,"pre_call_tool_calls":3,"native":[1672,941],
 "canvas":[1376,768],"ratio_error":0.0039,"reissues":0,
 "source_png":"C:/Users/…/019ff…/exec-5a2c2c62.png","source_sha256":"…",
 "composed_prompt":"_staging/_codex/prompts/L29.txt","composed_prompt_sha256":"…",
 "composed_chars":1740,"fidelity_audit":"verified","seed_sha256":{"…":"…"},
 "residual_idiom":[],"failure_class":null}
```

- `turn.completed.usage` is the authoritative token source (p1 probe A); the human-readable "tokens
  used" text is never scraped.
- `pre_call_tool_calls` counts `custom_tool_call` items in the rollout log before the image call —
  the ambient-detour meter (§5.1), which is how P4's empty-cwd verification is measured in production
  rather than only in a probe.
- `composed_chars` makes the brevity doctrine (§4.2) monitorable per frame, since length is a
  measured register lever.
- At run end the runner prints totals: frames, tokens in/cached/out, wall clock, mean
  `pre_call_tool_calls`, and any `fidelity_audit != "verified"` rows.

**Out of code — the cost ledger.** Each run records one row in the day's cost ledger
(`ledgers/cost/<agent>-<date>.tsv`): **$0.00 dollars**, with token totals and frame count in the
notes. Written by the **orchestrator**, not the runner — a generation script must not perform a
coordination write (ops branch, per CLAUDE.md's branch rules).

**Soft cap, no enforcement.** No daily cap in code, no auto-throttle. A rate-limit-classed event
stops the run loud (§6 class 6) and a human decides. **Alternative rejected:** sleep-and-retry backoff
like `nano()`'s L76-79 — that loop exists for a metered HTTP API with documented status codes;
inventing subscription-quota semantics from zero observed rate-limit events (21 gens across both
logs, none) would be a mechanism built on no data.

---

## 6. Retry / failure law mapping

**The doctrine is unchanged.** SKILL.md L384-393: exactly ONE auto-retry per frame, a *fresh gen off
a surgically re-authored prompt*, ruled by the next batch's fresh-eyes pass (L398-403), with
`retry_cause` logged and `suspected_mechanism_layer` recorded when exhausted (L394). This design adds
no new content-retry authority. It adds one strictly separate notion — a **transport re-issue**, the
standing 4-minute policy's "one re-issue": it re-sends the *identical* composed prompt file because no
image was produced at all. It never counts against the frame's one surgical retry and never fires
when an image *was* produced.

| # | Failure class | Detection | Handling |
| --- | --- | --- | --- |
| 1 | **Contract violation** (relative seed path, >5 seeds, slate over `CODEX_SEED_CAP`, seeding-law violation) | `preflight_batch` (L1146-1164) / runner assert, before any subprocess | Hard exit at $0 for the whole run, naming the shot. Never re-issued: deterministic. |
| 2 | **No image** (0 new PNGs, turn completed) | Snapshot diff (§4.6) | ONE transport re-issue → still 0 ⇒ per-item `ERR no_image`; run continues. |
| 3 | **Stall / timeout** (240s) | Subprocess timeout; **process tree** killed (§4.4) | ONE transport re-issue → still stalled ⇒ `ERR stall`. |
| 4 | **Non-zero exit / unparseable stream** | Exit ≠ 0, or no `thread.started` line | ONE transport re-issue (a cold-process fluke is plausible) ⇒ `ERR exec_failed` with a ≤160-char stderr tail. |
| 5 | **Multi-emit** (>1 new PNG) | Snapshot diff | NO re-issue. `ERR multi_emit`, paths logged. Indeterminate provider state is not re-rolled blind. |
| 6 | **Refusal / quota** (turn completes, no tool call; agent text refuses or reports a limit) | 0-PNG path + marker scan of `agent_message` | Not re-issued — re-issuing an unchanged refusal is re-rolling an unchanged mechanism (SKILL.md L394). `ERR refusal`; a **quota** classification stops the run loud (§5.3). **[THIN]** — no refusal observed in 17 gens, including a named convicted real person (p1 probe H). |
| 7 | **Ratio out of tolerance** (>5%) | Normalization (§4.6) | `ERR ratio` — no transport re-issue (an image exists; the model mis-framed). Re-authoring the framing line is a legitimate *surgical* retry through the normal overlay path. |
| 8 | **Invalid bytes** (≤1024 bytes / bad magic) | `validate_png` L118-125 | `ERR`; no survivor is ever written (the L119-120 rationale holds identically). |
| 9 | **Fidelity mismatch** (captured prompt ≠ composed file) | Rollout-log audit (§4.6) | Frame is **published but marked** `fidelity_audit: "mismatch"`, named in the run summary, parked by the fresh-eyes pass. No re-issue — the image may be fine; what is broken is our claim to have authored it. |
| 10 | **Unrequested in-image content** (props/set-dressing; text is now rare — §9.1.3) | Not machine-detected. Fresh-eyes fidelity axis (SKILL.md L368-376) + DSG-lite on lettered shots | The ordinary ONE surgical retry, tightening `Avoid:`. A second failure exhausts the frame and records `suspected_mechanism_layer: provider_limitation` (SKILL.md L394). |
| 11 | **Register drift** | §7's paired measurement + the style/taste axis (SKILL.md L377-379) | Never an auto-retry. A calibration finding routed to §7's ladder. |

Guard rails on the re-issue: **at most one per frame, ever** (`reissues` in the log row, so a second
failure reads as systematic), and a re-issue always starts a **fresh thread** even in `session` mode,
since classes 2-4 mean the session's state is suspect.

---

## 7. Register calibration study — paired, bounded, STOP-and-escalate

Ruling 5 sets the standard (peer engine, any shot class). Ruling 3 removes the escape hatch: the
register comes from **steering the engine or not at all** — no post-generation pass. P2b changed the
measurement itself, and this section is rewritten around that.

### 7.0 Why the target moved from a hex to a pairing

v1 measured against the style bible's pinned outline `#241a12` ⇒ M1 target **+18**. P2b measured all
23 real Gemini baseline frames with the same method (validated by reproducing p1's own G1/G2 numbers,
−6.5 and ~+8.0) and found:

| Statistic over the 23 verified Gemini frames | M1 (darkest-3% mean R−B) |
| --- | --- |
| Range | **+0.5 … +53.3** |
| Mean | +20.4 |
| The pinned-hex target | +18 (near the mean) |
| **L29 — the same shot both probe logs render** | **+0.5** |

The pinned hex is a decent *population* mean and a poor *per-shot* target: the channel's own accepted
output varies across a ~53-point range depending on scene lighting and palette. So a codex frame is
judged against **the real Gemini frame of the same shot**, not against a constant. On that bar the
best codex results are already close: P2b format 3 = +2.5 and format 2 = +4.6 against L29's real
+0.5 — distances of **2.0** and **4.1**.

### 7.1 Corpus and sampling

Four shots from `2026-07-28-bricks-fresh`, each with a verified Gemini baseline frame (§7.5). Kit
read-only; every output to arc staging.

| Shot | Class (from `shots.json`) | Why it is in the corpus |
| --- | --- | --- |
| **L26** | `map-plan-view`, no cast tokens, no `place` | Cast-free plate — the only class that takes the §5 style tile by law (SKILL.md L139-143); the purest read of a prose-only register. |
| **L44** | `personified-character`, one named figure (`ibm-suit`), place `miniscribe-floor` | Single-figure scene: cast seed carries the register, place plate carries continuity. |
| **L33** | `staged-interaction`, two named figures + `handshake` interaction template | Multi-seed composition at the cap. |
| **L29** | `personified-character`, one figure + quoted `'MINISCRIBE'` | Lettering-bearing, **and** the shot both probe logs already rendered — so P1's and P2b's numbers slot directly into this table. |

**n = 2 per (shot, variant) cell.** Engine variance is real and doctrine says so (SKILL.md L431:
generate a candidate batch rather than re-rolling one prompt serially). A lever counts as moving a
metric only when it moves it by **more than the within-cell spread** measured at L0.

**Stated limitation, not smoothed over:** each baseline shot was rendered by Gemini **once**, and this
arc may not spend Gemini API money, so *Gemini-side* per-shot re-render variance is unmeasurable here.
Every paired distance therefore contains an unknown amount of Gemini noise. Consequence for the gate:
a paired distance smaller than codex's own within-cell spread must be read as "indistinguishable",
never as "codex is closer than Gemini is to itself". **[THIN]** — inherent, not fixable at $0.

### 7.2 Metrics — per-shot paired distances

**Measurement rule first: every metric is computed on frames at the SAME canvas.** M2 is
neighbourhood-based and therefore resolution-sensitive; comparing a native 1672×941 codex render
against a 1376×768 Gemini frame would measure the resize, not the register. Codex frames are measured
*after* normalization (§4.6); baselines are already 1376×768.

For each shot *s* and metric *m*: **d_m(s) = |codex_m(s) − gemini_m(s)|**, reported per shot, never
averaged into one number across shots (averaging across a 53-point population spread is exactly the
mistake §7.0 corrects).

| ID | Metric | Definition | Reference |
| --- | --- | --- | --- |
| **M1** | Ink warmth | mean `R−B` over the darkest 3% of pixels by luma (the method both probe logs used, reproducible to ~0.1) | The same shot's baseline value. Known: L29 = +0.5. |
| **M2** | Flatness | fraction of pixels whose 5×5 neighbourhood luma range ≤ 4/255, excluding pixels within 2 px of an edge (Sobel above the frame's 90th percentile). High = flat cel fills; low = gradients/ambient shading. | The same shot's baseline value; the 23-frame spread sets what a *normal* difference looks like. |
| **M3** | Palette concentration | colours needed to cover 90% of frame area after 32-level-per-channel quantization | Same-shot baseline. |
| **M4** | Red-accent discipline | fraction of pixels within a small RGB radius of `#d7402b` | Same-shot baseline. |

Not measured: **line weight** — no robust single-number stroke-width metric is available, and
inventing one would produce a gate nobody can trust. It stays an eyeball judgement on the style axis
(SKILL.md L377-379), which is why every escalation packet carries a side-by-side board, not only a
table. **Not machine-measured either: unrequested content embellishment** (extra props/set-dressing),
which P2b saw in the shortest formats and in both bloated ones — the fresh-eyes fidelity axis rules
it.

### 7.3 Lever ladder — most levers are now defaults or dead

P2b converted three of v1's open questions into settled facts, so the ladder is much shorter:

| Lever | Status | Evidence |
| --- | --- | --- |
| Dedicated `Avoid:` field | **L0 default** — mandatory in every composed prompt | 2-3× closer to the paired target; zero unrequested text in every dedicated-Avoid run (P2b B/C) |
| Brevity (no restatement, no field without a source) | **L0 default**, with a length budget test | Bloat at constant facts ≈ 6× worse (P2b E1) |
| Short ordinal/role seed labels | **L0 default** | Zero content leak at every verbosity level; verbosity not protective (P2b D) |
| Tail/suffix strengthening; head+tail repetition of the house style | **DEAD — forbidden** | ~4× worse (P2b E2). This is Gemini's convention (`assemble_prompt` L273-290 documents the two-voice head/tail shape as a *Gemini* claim) and it does not transfer. |
| Verbose role prose / explicit "do NOT reuse X,Y,Z" | **Not a default**; reserved for a tile that has actually leaked | P2b D |

| Lever to run | What it changes | Gens | Why here |
| --- | --- | --- | --- |
| **L0 baseline** | The composer exactly as §4.1-4.3 specifies (labeled schema, Avoid field, short role labels, canvas line). | 8 | Fixes each paired distance **and codex's own within-cell spread**; every later claim is relative to it. |
| **L1 style tile as an ink/register seed** | Adds `refs/env/scene-style-tile.png` to *figure-bearing* codex frames (cast-free ones carry it by law), per §4.7's option (a), with a short "Image N: style reference only" label. ≤2 variants. | ≤16 | The one genuinely untested lever: P2b proved the tile is **safe** (zero content leak under all framings) but never isolated whether it moves ink, because its D runs had no `Avoid:` field and all drifted warm. It also tests a channel prohibition, so it runs under measurement, not by assumption. |
| **L2 format length** | Labeled-schema (P2b format 2 shape, ~1700 chars) vs minimal-prose + Avoid (format 3 shape, ~600 chars), same facts. | 8 | Both are measured winners with a real trade: format 3 edged on ink (+2.5 vs +4.6), format 2 volunteered less extra scene content. One paired run over the corpus decides which the composer defaults to per shot class. |
| **L3 canvas choice** | Re-normalize the *same* renders to a 1K vs 2K canvas; re-measure M2/M3. | 0 | Free; tests whether the downscale ratio itself buys flatness (§4.6). It changes an input-side setting, not the rendered frame, so it is inside ruling 3's line. |

**Forbidden (ruling 3): any post-generation register pass** — palette quantization toward the scene
palette, recolouring the darkest cluster toward `#241a12`, gradient flattening, or any equivalent. A
frame that needs retouching to pass is a frame the engine did not render on-register; shipping it
would make the review gate measure our post-processor instead of the engine.

**Hard budget: 40 generations** (L0 8 + L1 ≤16 + L2 8, plus 8 spare for a re-measure). $0 spend;
~1.5-2 h wall clock. **No lever gets a third variant** — a third wording is where an unbounded chase
starts, and doctrine names that failure (3+ failed fixes ⇒ question the architecture, skills README).

### 7.4 Gates — and the floor that needs re-ratification

> ### ⚠ RULING 4 NEEDS RE-RATIFICATION IN PAIRED FORM
>
> Daniel ratified **`M1 ≥ +15`** when the target was the pinned hex (+18). P2b refuted that framing:
> the real Gemini render of L29 measures **+0.5**. Applied literally to paired judging, the old floor
> **inverts** — a codex frame at +2.5 (distance **2.0** from the truth) would FAIL, while a frame at
> +15.0 (distance **14.5**) would PASS. The number cannot be carried across unchanged.
>
> **Proposed translation — PROPOSAL, NOT RULED:**
> - **`|ΔM1| ≤ 5` per shot**, on at least 3 of the 4 corpus shots (P2b's best already sits at 2.0 on
>   L29, so this is a real but reachable bar); and
> - **`|ΔM2|` within the baseline band** — no worse than the interquartile width of M2 across the 23
>   verified frames, i.e. codex must differ from its paired frame by no more than accepted frames
>   differ from each other; and
> - **M3/M4 inside the same band.**
>
> Daniel rules on these numbers before the study's verdict is binding. Running the study is not
> blocked on the ruling — the measurements are the same either way — but **no PASS is declared** under
> a floor he has not ratified.

- **Promote a lever** only if it reduces its target paired distance by more than the L0 within-cell
  spread, on at least 3 of the 4 shots, and worsens no other metric beyond that spread.
- **Stop a lever early:** if a variant worsens `|ΔM1|` by more than 3 against the best so far, stop
  that lever — do not rescue it with a third wording.
- **PASS** ⇒ the study goes to the P5 live slice with the winning configuration frozen into the
  composer and written into the skill's engine section before production use (prove, then register,
  then emit).
- **STOP-and-escalate** once L1 and L2 are exhausted without clearing the ratified floor. The packet:
  the full paired table (shot × lever × rep, with both raw values and the distance), a side-by-side
  board (baseline vs best codex variant per shot, published as an artifact with lightbox), the levers
  tried with measured deltas, and a recommendation of exactly two outcomes — **(a) accept the measured
  difference for a named shot class**, or **(b) park the engine**. Post-processing is not on the menu
  (ruling 3). **No further generation after the packet until he rules**: re-rolling an unchanged
  mechanism is forbidden (SKILL.md L394), and "more wordings" after two exhausted levers is exactly
  that.

### 7.5 Baselines

`scratch-codex-image-engine/gemini-baseline/` holds **23 verified 6c2 Gemini frames** (L26-L50,
read-only copies from the main checkout) plus `SHAS.txt` (sha256, byte size, provenance). Every frame
is **1376×768**, which is what fixes §4.6's `(16:9, 1K)` canvas to real pipeline output rather than
SKILL.md L130's approximate "~1344×768".

- **Pairing** is the primary use: each corpus shot's own frame is its reference (§7.2).
- **Band:** the 23-frame spread of each metric defines what a *normal* difference looks like, which
  is what §7.4's M2/M3/M4 tolerances are built from.
- **Integrity:** the study re-verifies each baseline sha against `SHAS.txt` before measuring, so a
  silently altered reference can never move a gate.
- **Sanity:** the 23 also validate the metric script itself — a metric whose Gemini spread is absurdly
  wide is a broken metric, not a finding. (M1's method is already validated: P2b reproduced p1's G1/G2
  numbers to ~0.1.)

---

## 8. Testing strategy

### 8.1 The fake codex binary fixture

Contract of `_fake_codex.py` — written by the test into a temp dir, invoked as a subprocess exactly as
the real binary would be:

- **Invocation:** tests patch module attributes on `forge_codex` —
  `CODEX_ARGV_PREFIX = [sys.executable, str(fake_py), "--mode", "<mode>"]`,
  `IMAGE_ROOT = <tmp>/generated_images`, `SESSIONS_ROOT = <tmp>/sessions`, and `TIMEOUT_S = 2` for
  stall cases. The runner builds its command as
  `CODEX_ARGV_PREFIX + ["exec", "--json", "--sandbox", "workspace-write", "--cd", cwd, envelope]`, so
  the fake receives the **real argv tail** and can assert on it (flags, cwd, envelope text, prompt
  path). **Alternative rejected:** an environment-variable override (`FORGE_CODEX_BIN`) — an env var
  that redirects which binary a production script executes is a code-execution surface existing purely
  for tests; module attributes are patchable with zero production surface.
- **Output:** real JSONL on stdout in the observed shape —
  `{"type":"thread.started","thread_id":"<deterministic id>"}`, `turn.started`,
  `{"type":"item.completed","item":{…"agent_message"…}}`, `{"type":"turn.completed","usage":{…}}` — a
  **real PIL-generated PNG** of a chosen size with a known dark-ink colour (so §7's metric code is
  unit-testable against a frame whose M1 is known by construction) into `IMAGE_ROOT/<thread_id>/`,
  **and a rollout JSONL** at `SESSIONS_ROOT/<Y>/<M>/<D>/rollout-<ts>-<thread_id>.jsonl` containing a
  `custom_tool_call` item whose JS embeds the prompt it "sent" — the fidelity-audit fixture.
- **Contract enforcement:** in every mode the fake first reads the prompt file and the envelope and
  fails like the real tool if a seed path is relative (`AbsolutePathBuf deserialized without a base
  path`) or if more than 5 paths appear (`referenced_image_paths must contain at most 5 paths`), so
  the runner's asserts are tested against real error strings (p1 hard limits 1-2).
- **Failure-mode switches (`--mode`):** `ok` · `ok_portrait` · `wrong_ratio` (4:3 for a 16:9 ask) ·
  `no_image` · `two_images` · `tiny_png` · `stall` · `nonzero_exit` · `bad_json` · `no_thread_event` ·
  `refuse` · `quota` · `resume_ok` (a second turn into the same thread dir) · **`paraphrase`** (writes
  a rollout log whose captured prompt differs from the composed file — exercises class 9) ·
  **`no_rollout`** (no session log at all — exercises `fidelity_audit: "unverifiable"`).

### 8.2 `test_forge_codex.py` — the whole test surface

Plain asserts, no pytest, run as `py -3 .claude/skills/image-generation/scripts/test_forge_codex.py`
(house style, `test_forge_hold.py` L2):

1. **Import-surface contract** — every symbol imported from `forge` (§3.2) exists and accepts the
   expected arguments; `import forge` performs no side effects (no network, no `.env` read, no file
   write). This is the test that makes ruling 7's library coupling loud instead of silent.
2. **No-key construction** — `Kit(kit, dry=True)` succeeds with `GEMINI_API_KEY` absent, and
   `k.url is None` (the "cannot call Gemini by construction" property, §2.3).
3. **Composer determinism** — composing the same spec item twice yields byte-identical text; the sha
   in the log row matches the file on disk.
4. **Field mapping** — `Primary request:` is `item["payload"]` verbatim after idiom translation;
   `Input images:` matches `item["seed_roles"]` in order with the right role words;
   `Text (verbatim):` carries `'MINISCRIBE'` on L29 and the field is **absent** when the payload
   quotes nothing (with `Avoid:` leading on words instead); a field with no source is omitted rather
   than emitted empty.
5. **Brevity budget** — a composed prompt for each corpus shot stays under the configured character
   budget, and no fact appears in two fields (the measured 6×-worse antipattern, §4.2).
6. **Dead levers stay dead** — the composed text contains no head+tail repetition of the style block
   and no duplicated register clause (guards the P2b E2 finding against regression by future editing).
7. **Idiom table** — `stage-left/right/centre`, `upstage`, `camera-left` translated; quoted literals
   untouched; the same nouns survive (no fact deleted). Uses L46/L47's real prompt text. Residual scan
   WARNs without raising.
8. **Canvas + framing line** — exact string for `(16:9,1K)` = 1376×768, plus `(2:3,1K)`, `(9:16,1K)`;
   an unknown `(aspect,size)` raises naming the pair.
9. **Seeds** — a relative path raises before any subprocess; 6 seeds raise; absolute Windows paths
   survive `realpath`; a mutated seed raises `SeedIntegrityError`; a hand-edited spec whose slate
   exceeds `CODEX_SEED_CAP` raises naming the shot (never truncates).
10. **Harvest** — fresh thread ⇒ one new PNG accepted; pre-existing files ignored (snapshot diff);
    `two_images` ⇒ `multi_emit` listing both; `no_image` ⇒ exactly one re-issue then `ERR`.
11. **Fidelity audit** — `ok` ⇒ `verified`; `paraphrase` ⇒ `mismatch` (frame still published, shot
    named in the summary); `no_rollout` ⇒ `unverifiable` (not a failure); the runner reads only the
    rollout file matching its own thread id.
12. **Failure classes 2-9** each map to the documented class, message and `reissues` count; `refuse`
    and `quota` are not re-issued; `quota` stops the run.
13. **Normalization** — 1659×948 ⇒ exactly 1376×768 via crop-then-resize (assert the cropped
    intermediate's ratio); a 4:3 render for a 16:9 ask raises `RatioError`; output passes
    `validate_png`.
14. **Staging discipline through forge's own primitives** — a published frame lands at
    `_staging_png(k, name)`; a pre-existing valid survivor is skipped without a subprocess unless
    `--force`; a concurrent lock is respected; a failed gen leaves **no** file and no stale lock.
15. **Split-run isolation** (replaces v1's mixed-slate preflight test) — running the runner with
    `--shots A` and forge-style publication of `B` over the same spec produces disjoint outputs, no
    lock collision, and the codex log holds exactly one row (for A).
16. **`--shots` filtering** (replaces v1's per-item-engine precedence test) — only named items are
    consumed; an unknown id raises naming it; omitting `--shots` consumes the whole spec.
17. **Dry run** — `--dry-run` prints every composed prompt in full, resolves and validates every seed,
    runs the seeding-law preflight, and spawns **zero** subprocesses (assert the fake was never run)
    and writes no PNG.
18. **Engine log** — one row per generated frame with every documented key, including
    `pre_call_tool_calls`, `composed_chars` and `fidelity_audit`.
19. **Session mode** — `resume_ok` harvests turn 2 from the shared thread dir; a resume failure falls
    back to `isolated` once and records it.

### 8.3 Changes to existing test files: NONE

v1 planned three additions to `test_forge_seed_requirement.py` and one to `test_forge_style_tile.py`.
Ruling 7 removes the need for all of them, and v1's cases 13/15/16 go with them:

| v1 test | Why it is gone | What replaces it |
| --- | --- | --- |
| Gemini default/engine resolution + key-load timing in `test_forge_seed_requirement.py` | No `Kit` signature change exists to regress | §8.2 case 2 (`dry=True` gives no key and no URL) |
| Tile law engine-independence in `test_forge_style_tile.py` | The tile law is untouched — the slate is built by unedited `cmd_batch` | §7's L1 measures the tile lever without changing the law |
| **Case 13** (engine-scoped cap threaded into `cmd_batch`'s displacement walk) | `cmd_batch` is not modified | §8.2 case 9 (cap enforced **on consumption**, fail-loud, never truncating) + §10 keeps the walk design for Wave 2 |
| **Case 15** (per-item `engine` precedence + `policy_fingerprint` refusal) | No per-item engine field in v1 | §8.2 case 16 (`--shots` filtering is how a run selects its subset) |
| **Case 16** (mixed-slate preflight constructing both providers) | No in-process provider registry in v1 | §8.2 case 15 (split-run isolation over one spec) |

**The stronger guarantee replaces all of them:** `git diff --exit-code
.claude/skills/image-generation/scripts/forge.py` must be empty. A mechanical check beats a regression
suite's opinion, which is exactly why ruling 7 was made.

### 8.4 P5 live-slice acceptance

Slice = **6 shots** from `2026-07-28-bricks-fresh`, spec built by unedited `forge.py batch`, kit
read-only, **all outputs to arc staging** (never the video's `assets/`): **L26** (cast-free plate),
**L44** (single figure), **L33** (two figures + interaction template), **L29** (lettering-bearing),
**L46** (declared crowd + seeded performer + a literal "stage-left" — the idiom translation's live
test), **L31** (a `delta` beat, so the chain-parent seeding path runs). Acceptance is all of:

- **A. Zero blast radius.** `git diff --exit-code .../forge.py` is empty; no file written outside
  `<kit>/_staging/` and the arc scratch.
- **B. Mechanics.** 6/6 staged PNGs at exactly 1376×768; exactly one new PNG per call; 0 contract
  violations; ≤1 transport re-issue across the slice.
- **C. Provenance.** One complete engine-log row per frame; every composed prompt archived; every row
  carries `fidelity_audit` and the count of `mismatch` rows is **0** (`unverifiable` is acceptable and
  reported); one $0 cost-ledger row recorded by the orchestrator.
- **D. Register.** M1-M4 measured per shot as paired distances against each shot's baseline, ruled by
  §7.4's floor **once ratified**.
- **E. Review.** A fresh-eyes pass on the three axes (SKILL.md L356-379) with honest states,
  explicitly counting (i) unrequested-text defects and (ii) unrequested-content embellishments — two
  separate numbers, because P2b's evidence separates them (§9.1.3).
- **F. Split-run mixing.** Codex runs 2 of the 6 shots; unedited `forge.py gen` then runs the same
  spec and **skips** those two via skip-if-exists while generating the rest; both halves land in one
  staging dir, the manifest records `engine` per entry, and no lock collision occurs.
- **G. Cost shape.** Mean `pre_call_tool_calls` and mean input tokens reported; if the empty-cwd
  control (§4.4) is not zeroing the ambient detour, that is surfaced as a number, not a footnote.
- **H. Spend + boundaries.** $0 API spend; `.env` never read; main checkout untouched; baseline shas
  re-verified unchanged.

Explicitly **not** acceptance: "as good as Gemini". That is §7.4's measured floor plus Daniel's taste
ruling; no worker declares it.

### 8.5 P4 probe list (runs before the build hardens)

Carried from P2b COMPOSER BRIEF (f), plus the two integration unknowns this spec depends on. Each is
a small, bounded, $0 probe:

1. **Empty-tempdir `--cd` zeroes the ambient-repo detour?** Measure `pre_call_tool_calls` and input
   tokens with cwd = fresh temp dir vs cwd = worktree. Blocks §5.1's quota math and §4.4's boundary
   claim. *(P2b Q3)*
2. **`--sandbox read-only` hang — reproducible, and is there a tighter-than-`workspace-write` mode
   that fails fast?** Bounded at one attempt with a hard kill at 4 minutes. Blocks nothing (production
   uses `workspace-write`), but a silent hang in a sandbox someone might later try is worth knowing.
   *(P2b Q2)*
3. **Session mode:** does `exec resume` emit `thread.started`, write into the same `<thread_id>`
   image dir, keep verbatim pass-through per turn, and preserve the Avoid/brevity findings across
   turns? Blocks enabling `session` by default. *(P2b Q6)*
4. **Do the format findings generalize beyond the single storefront-style shot?** Run L0 across the
   4-shot corpus (this is §7's L0 — the probe and the study's first rung are the same 8 gens).
   *(P2b Q1)*
5. **Is there a brevity floor?** At what point does trimming cost identity/prop/composition fidelity
   rather than only register? Folded into §7's L2 (format length), judged on the fidelity axis, not
   only on M1. *(P2b Q5)*
6. **Does the style tile move ink specifically?** This is §7's L1 — listed here because P2b named it
   as the open register question (*Q4*), and it is the only remaining register lever.
7. **Canvas rows for `2:3` and `9:16`** verified against real Gemini frames of those ratios before any
   codex frame of that ratio is promoted (§4.6 **[THIN]**).

---

## 9. Risks + what returns to Daniel

### 9.1 Risks carried into the build

1. **The register may not clear a peer floor.** The paired gap is small on the one shot measured twice
   (best 2.0 on L29) but unmeasured on the other three classes, and ruling 3 removes post-processing
   as a fallback. "Park it" remains a live outcome. The study is deliberately cheap (≤40 $0 gens) so
   this is discovered fast.
2. **Mixed-engine register consistency rides on review.** Ruling 2 allows per-shot mixing (as split
   runs, §2.2) and no mechanism refuses it. **Live tension, stated once:** mixing is legal *today*
   while the paired register gap is still unmeasured on most shot classes — so until §7 reports, a
   mixed video is review-guarded territory and should be a deliberate, eyes-open choice. The `engine`
   key on each manifest entry exists so that choice is auditable afterwards.
3. **Unrequested in-image TEXT: mitigated, evidence-backed** (was v1's largest untested risk). Every
   dedicated-`Avoid:`-field run in P2b produced **zero** unrequested text, across both winning formats
   — and the two P1 incidents (`TOTE RACK / STAGE-LEFT`, `DEFENSE COUNSEL`) came from prompts with no
   such field. **What remains is unrequested CONTENT**, not text: P2b's short format added floor
   lane-markings and extra bench props, and both bloated variants added more (a pegboard, a desk
   lamp, an office chair). So the residual risk is a *fidelity-axis* one — the engine volunteers
   set-dressing — and it correlates with prompt length, which the brevity default already fights.
   Measured separately at P5 (§8.4 E).
4. **Permanent resolution-instrument mismatch** (§4.6): codex renders at its own ~1.5-1.7 MP; the 1K
   era instrument cannot be requested, only approximated by downscale.
5. **Prompt-fidelity risk: largely retired, with a residual.** v1 listed "an LLM sits between our
   prompt and the tool" as unverifiable. P2b verified byte-for-byte pass-through twice, via two
   different internal mechanisms, and this spec makes the rollout-log audit a **production** check
   (§4.6). Residual: the audit is `unverifiable` whenever the model uses the read-into-variable
   mechanism (which is the safer one), so the guarantee is "verified or safely-unverifiable", not
   "always verified".
6. **Ambient-repo reads are a boundary AND cost risk.** One measured call made 24 tool calls before
   the image call — reading `CLAUDE.md`, `orgs/kb-ops/contract.md`, `STATE.md`, `BOSS.md`, `_index.md`
   and attempting to run `scripts/preamble.py` — at 8× the token cost. A prompt-level scope
   instruction cut ~74%; only the empty temp cwd plausibly zeroes it, and that is **[THIN]** until
   P4 measures it (§8.5 probe 1).
7. **CLI contract drift.** Everything is pinned to `codex-cli 0.146.1` behaviour — event names, the
   images path, the sessions-log shape, the error strings, the flag set — with no stability guarantee.
   The codex-side tool skill (`~/.codex/skills/.system/imagegen/`) can also change under us, and its
   standing "normalize into a clear spec" default is precisely what the pass-through incantation
   overrides; a reworded skill doc could weaken that override. Mitigation: the fake-binary fixture
   encodes the observed contract, so re-probing a new CLI version is a cheap diff — but it must be
   *run*, not assumed.
8. **Library coupling to forge.py internals.** The codex runner imports private staging primitives
   (§3.2). A forge.py refactor can break it — deliberately loudly, via §8.2's import-surface contract
   test, but it *will* eventually happen and someone must fix the codex side then. This is the price
   of ruling 7's zero-edit guarantee, and it is the right trade while other terminals are live.
9. **Seed TOCTOU** (§4.5) — inherent to a path-based tool contract.
10. **Wall-clock at peer scale.** 70-165 s/frame means a 246-shot video is 5-11 h in `isolated` mode
    (more if the detour is uncontrolled); `session` mode's saving is unmeasured **[THIN]**. Peer use
    may be gated by patience before it is gated by register.

### 9.2 Rulings on record

| Question | Ruled |
| --- | --- |
| Placement | **Standalone runner** importing forge.py read-only; zero forge.py edits in v1 (ruling 7, §2-3). |
| Provider scope | The codex side owns its own generation doctrine — prompt, seeding emphasis, cap, run logic (ruling 1, §3.1). |
| Mixed engines in one video | **Allowed per-shot**, realized as split runs over one slate; review carries the consistency burden (ruling 2, §2.2). |
| Post-processing the register | **Forbidden** — steer the engine or park it (ruling 3, §7.3). |
| What codex is *for* | **Full peer engine, any shot class**; routing is taste/A-B (ruling 5, §1). |
| Quota policy | **Soft cap + ledger, no enforcement**; rate-limit ⇒ stop loud (ruling 6, §5.3). |
| The register floor | **`M1 ≥ +15` was ratified against a framing P2b refuted and cannot be carried across unchanged** — §7.4 carries a proposed paired translation (`|ΔM1| ≤ 5`, M2/M3/M4 within the baseline band) marked PROPOSAL. **This is the one open decision in the spec.** |

### 9.3 What comes back to him later, with evidence attached

1. **The paired floor** (§7.4) — the only item that needs a ruling *before* a PASS can be declared.
2. **Raising `CODEX_SEED_CAP` to 5 / promoting the style tile to figure-bearing codex frames** — only
   if §7's L1 shows the tile buys ink; it changes a channel law held by `test_forge_style_tile.py`,
   so it routes through Wave 2 (§10) rather than the runner's study-only shortcut (§4.7).
3. **The §7.4 escalation packet**, if L1+L2 fail: accept the measured difference for a named shot
   class, or park the engine (those two only).
4. **Enabling `session` mode by default**, once P4 measures resume behaviour and the real saving.
5. **Wave 2 go/no-go** (§10) — after bricks ships, when editing forge.py is safe again.

---

## 10. Wave 2: in-process integration (deferred)

Ruling 7 defers, not cancels, the in-process design. It is recorded here in full so the thinking
survives the standalone wave. **Trigger: after the bricks run ships and no other terminal is live on
the Gemini path.** Nothing in this section is built in v1.

**What Wave 2 would add**

1. **Engine selection, item > run > channel.** `engine = item["engine"] or --engine or
   registry["engine"]` (registry L3, read at `Kit.__init__` L313), mirroring `image_size`'s per-item
   twin at L1200. `ENGINES` becomes a closed set like `IMAGE_SIZES` (L55); an unknown id exits before
   any call.
2. **A provider seam at the call site.**
   `generate(*, prompt_text, seeds, aspect, image_size, name) -> (bytes, metadata)`, replacing L1223
   only, with L1224-1226 (`to_png_bytes` → `validate_png` → `_publish_staging_png`) unchanged beneath
   it. Returning **bytes**, not a path, keeps one writer of staging.
3. **Provider construction with unchanged failure timing.** `Kit.__init__` builds the run-level
   provider (so a missing `GEMINI_API_KEY` still raises at `Kit(...)`, CLI L2558);
   `preflight_batch` (L1146-1164) constructs any *additional* engines a mixed spec names, so a mixed
   slate missing a key still fails at $0 with the full violation report; `dry=True` constructs none.
4. **Slate-time policy as classmethods** — `seed_cap()`, `register_seeds(shot_facts)`,
   `policy_fingerprint()` — callable with no instance, no key, no subprocess, so `batch` (always dry)
   can fit the slate to the right engine's law without being able to reach an engine. Import of the
   provider module must stay side-effect-free.
5. **Engine-scoped cap inside the displacement walk.** `cmd_batch` resolves
   `cap = PROVIDERS[engine].seed_cap()` once; the three `len(seed_roles) > SEED_CAP` comparisons
   (L1873, L1881, L1893) become `> cap`. **The walk's order and never-droppable floor do not change**
   — crowd exemplar → interaction template → tagged prop, never the place plate/chain parent, the
   LOCKED §5 lettering exemplar or scene style tile, or any character STEP-1 (L1861-1872). Order is
   shot truth; the threshold is provider truth. The over-cap hard error keeps naming the true bind —
   cast count against the cap (SKILL.md L177-179).
6. **`register_seeds()` competes inside the walk**, appended to the candidate roles *before*
   displacement, so a provider can never smuggle a seed past the floor — the correctness property
   §4.7's study-only shortcut deliberately lacks.
7. **Per-item stamping.** `batch` writes `engine` **and** `policy_fingerprint` onto each item — never
   into a spec-level envelope, because a gen spec is a JSON *list* (`gen` iterates it at L2561;
   `batch_provenance` reads `for item in spec if isinstance(spec, list)`, L2399), so an envelope would
   silently drop C-11 provenance and break the loader. A `gen --engine X` run over items stamped `Y`
   is a hard error naming the shots unless the fingerprints match.
8. **The tests that go with it** (v1's cases 13/15/16, restored at that point): cap threading through
   the displacement walk with a stub provider at cap 5; per-item engine precedence and fingerprint
   refusal; mixed-slate preflight constructing both providers and failing early without the key; plus
   the Gemini-path regression cases in `test_forge_seed_requirement.py` that ruling 7 makes
   unnecessary today.

**What Wave 2 buys, honestly:** one command instead of two for a mixed video; slates fitted to a
diverged codex cap (the only way option (b) in §4.7 becomes correct); and one engine log written by
one runner. **What it costs:** the zero-edit guarantee. That is why it waits.

---

*Nothing in this spec has been built. Every generation it describes is a $0 subscription call; no API
spend is authorized anywhere in this arc.*
