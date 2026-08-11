# codex CLI as a second image engine — design

**Date:** 2026-08-11 · **Skill:** `.claude/skills/image-generation` (`scripts/forge.py`) ·
**Test bed:** `channels/the-second-take/videos/2026-07-28-bricks-fresh` (kit read-only, outputs to
arc staging) · **Status:** Daniel-ruled at spec review; this is the implementation plan.
**Trigger:** P1 capability probe (`scratch-codex-image-engine/p1-probelog.md`, 8 real generations)
established that the codex CLI's `image_gen__imagegen` tool holds figure identity, composes
multi-seed scenes without bleed and depicts named real people — but is out of register, mints
unrequested text, and reports nothing structurally. Daniel ruled it calibratable and worth building
as a **full peer engine**.

**Daniel's six rulings, all integrated below:** (1) placement = sibling module, **widened** — the
provider owns codex-specific generation doctrine, not just transport (§3, §4.7); (2) **mixed engines
per-shot are allowed in v1** (§2.2); (3) **post-processing the register is forbidden** (§7.3);
(4) register floor is **M1 ≥ +15 / M2 within 5 points** (§7.4); (5) codex is a **peer engine for any
shot class**, routing is taste/A-B (§1, §5.2); (6) quota is **soft cap + ledger, no enforcement**
(§5.3).

Ground truth: `scratch-codex-image-engine/p1-probelog.md` (empirical), `forge.py` + `SKILL.md`
(current doctrine). Every integration claim cites a line; every decision names the alternative
rejected; thin evidence is flagged **[THIN]** rather than smoothed over. Line citations are against
`orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py` (2608 lines) and
`.../image-generation/SKILL.md`.

---

## 1. Goal + non-goals

**Goal.** Make the codex CLI's `image_gen__imagegen` tool a **peer generation engine** in the
`image-generation` skill — subscription-billed, $0 API spend — usable for **any shot class** at
equal register once calibrated, selectable per run *and per shot*, without re-authoring
`shots.json`, the staging/lock discipline, the review gate or the manifests. Success condition:
`forge.py gen --batch <spec> --engine codex-imagegen` produces staged PNGs at the run's target
canvas that enter the *same* fresh-eyes review loop with the *same* per-frame bookkeeping as a
Gemini run; a bounded calibration study reports, in numbers, whether codex clears the peer-register
floor (§7.4); and the choice between engines becomes a taste/A-B decision rather than a capability
one.

**Non-goals.** Not a replacement for Gemini: `gemini-3-pro-image` stays the registry default and
every existing invocation keeps byte-identical behaviour (§2.5). Not a cheap-bulk lane — codex is
never scoped to "plates and inserts only"; if it cannot hold the register for cast work it is parked
rather than demoted (§7.4). Not a quality promise: the study is bounded, measured, and may end in
"park it". Not an `image-generation` doctrine rewrite — slate building, the staging discipline, the
review states, the one-surgical-retry law and the manifests stay engine-blind (§3.1); what becomes
engine-scoped is exactly what the provider must own to speak well (seed cap, register seeds, prompt
stress). Where codex *cannot* satisfy an existing law (the 1K render instrument, §4.6) that is
written down as a known register difference, never silently redefined. No new credential of any kind
enters the pipeline.

---

## 2. Engine selection mechanics

### 2.1 Where the selection lives today

`Kit.__init__` already reads an engine id: `self.model = self.reg.get("engine", "gemini-3-pro-image")`
(forge.py L313), fed by `registry/registry.json` L3. That id is consumed in exactly one place —
`url_for()` L331-333 builds a Google endpoint from it — so today the field selects a *model within
one provider*, not a provider. The whole network path is `cmd_gen` L1221-1226: assemble parts →
`nano()` → `to_png_bytes` → `validate_png` → `_publish_staging_png`.

### 2.2 Three levels of selection: item > run > channel

```
engine = item["engine"]          # per-batch-item, written by `batch`, overridable by hand
      or --engine <id>           # per-run override (gen and batch both accept it)
      or registry["engine"]      # channel default, unchanged: "gemini-3-pro-image"
```

- **Per-item `engine` is built now** (Daniel's ruling 2), exactly mirroring `image_size`'s per-item
  twin at L1200 (`size = r.get("image_size") or image_size`). A video may therefore mix engines
  shot by shot in v1.
- `batch` **stamps the resolved engine onto every item it emits**. This is not decoration: the seed
  cap and the register-seed policy are engine-scoped (§3.3, §4.7), so a slate is only valid for the
  engine it was built for. Consequently `batch` accepts `--engine` too (it did not need to before).
- **A `gen --engine X` run over a spec whose items say `Y` is a hard error**, naming the shots and
  instructing a rebuild — *unless* the two engines resolve to the same seed cap and register-seed
  policy, in which case the override is accepted and recorded in the engine log. Alternative
  rejected: silently letting the run-level flag win — that would execute a slate built under one
  engine's cap through another engine's law, which is precisely the class of silent mismatch the
  seeding law exists to prevent.
- **Authoring a mixed video, pinned so it reads one way.** As shipped, both engines declare the same
  cap (4) and an empty register-seed policy, so their `policy_fingerprint()` values match and simply
  hand-editing an item's `engine` in the spec is a complete and legal mixed-video route. **If a later
  ruling diverges codex's cap or register policy** (§9.3), that hand edit stops being valid — the
  item's slate was fitted to the other engine's law — and the mixed route becomes: rebuild just those
  shots with the existing opt-in repair scope, `batch --shots <ids> --engine codex-imagegen`
  (L2527-2530), then merge the two item lists. Either way the per-item `policy_fingerprint` check at
  preflight is what decides, at $0, and it names the shots.
- Engine ids are a closed set, mirroring `IMAGE_SIZES` (L55): `ENGINES = ("gemini-3-pro-image",
  "codex-imagegen")`. An unknown id is a `SystemExit` — at `Kit` construction for the run-level id,
  at `preflight_batch` (L1146-1164) for a per-item id, both before any provider call.
- **Review carries the register-consistency burden for a mixed video.** No mechanism refuses a
  mixed slate; the fresh-eyes style/taste axis (SKILL.md L377-379) and the human board are what
  catch two registers inside one cut. Stated as a risk, not hidden (§9.1.2).

### 2.3 Key loading — the conditional

Today `Kit.__init__` L316-322 hard-requires the key whenever `dry` is false:

```python
if dry:  self.key, self.url, self.ctx = "", None, None
else:    self.key = load_env(self.root)["GEMINI_API_KEY"]; self.url = self.url_for(); self.ctx = ctx()
```

Codex needs **no key at all** — it authenticates through the operator's existing codex CLI session,
which the pipeline never reads, prints, copies or persists. The repo's hard credential ceiling is
satisfied by construction: forge never handles a codex credential as an object.

```python
self.dry     = dry
self.engine  = engine or self.reg.get("engine", "gemini-3-pro-image")   # L313 semantics preserved
self.providers = {}                                     # engine id -> live provider instance
if not dry:
    self.providers[self.engine] = PROVIDERS[self.engine](self)          # constructed IN __init__
```

- `GeminiProvider.__init__(kit)` performs exactly the three statements above and leaves `kit.key`,
  `kit.url`, `kit.ctx` assigned for any reader. `CodexProvider.__init__(kit)` loads nothing, leaves
  the dry triple `("", None, None)` in place, and resolves the codex binary + generated-images root
  (§4.4).
- **The run-level provider is still constructed in `Kit.__init__`**, so a missing `GEMINI_API_KEY`
  still raises `KeyError` from `load_env` at `Kit(...)` (CLI L2558), before any request is read.
  Alternative rejected: lazy construction everywhere — cleaner, but it moves an existing
  misconfiguration's failure to mid-batch, which is a behaviour change on the Gemini path.
- **Extra engines named by per-item fields are constructed in `preflight_batch`** (L1146-1164),
  which already walks the whole batch at $0 before the first call: it collects the distinct engines
  the spec references and instantiates any not already live. So a mixed slate missing the Gemini key
  still fails early, at $0, with the batch's complete violation report — the same posture as the
  seeding-law abort at L1161-1163. `cmd_gen` then looks providers up by item engine, never
  constructing at call time.
- `dry=True` (CLI L2557: `gen --dry-run` and every `batch` build) constructs **no** provider at all,
  for any engine — so a slate build still cannot reach an engine even by mistake (the invariant at
  L2555-2556 and L316-318 survives verbatim). Slate-time engine policy is read from provider
  **classmethods**, which require no instance (§3.3).

### 2.4 CLI surface added

| Flag | Commands | Default | Notes |
| --- | --- | --- | --- |
| `--engine {gemini-3-pro-image,codex-imagegen}` | `gen`, `batch` | registry `engine` | Run-level selection; `batch` stamps it per item. |
| `--codex-session-mode {isolated,session}` | `gen` | `isolated` | §5.2. |
| `--codex-session-span N` | `gen` | `8` | Turns per session before a fresh thread (§5.2). |

All three sit in the `main()` argparse block at L2504-2554 beside `--image-size` (L2517), which has
exactly the "usually the default, sometimes a per-run call" shape these share.

### 2.5 The no-behaviour-change guarantee for Gemini runs

| Invariant | Held by |
| --- | --- |
| Same prompt bytes | The codex adaptation layer (§4.1) lives inside the codex provider, downstream of `k.prompt_for(...)` (L1197). `assemble_prompt` (L273-290) is untouched. |
| Same request | `nano()` (L59-83) moves verbatim behind `GeminiProvider.generate` — no signature change, no retry-loop edit. |
| Same bytes handling | `to_png_bytes` (L100-116) → `validate_png` (L118-125) → `_publish_staging_png` (L1121-1143) stay in `cmd_gen`, shared by both engines (the seam returns *bytes*, §3.2). |
| Same seed integrity | `ip()` (L90-95) still reads checked bytes straight into the Gemini request at L1221. |
| Same staging/lock | `_reserve_staging_output` (L1092-1118) and the release at L1236-1237 are engine-agnostic and unmoved. |
| Same slate | `GeminiProvider.seed_cap()` returns 4 and its register-seed policy is empty, so `cmd_batch` emits byte-identical specs for a Gemini run (§4.7). |
| Same failure text | Per-item `except Exception` → `report(name, "ERR ...")` L1233-1234; `SeedIntegrityError` still aborts the batch at L1230-1232. |
| Same files written | The engine log (§5.3) is written only when a provider returns non-empty metadata; Gemini returns `{}`, so a pure-Gemini run creates **zero** new files. |
| Proof | Tests assert an unchanged assembled prompt, request parts, aspect/size arguments, emitted slate and staged bytes pre/post change (§8.3). |

---

## 3. Placement — sibling module, widened boundary

**Ruled: Shape A, widened.** `forge_codex.py` is not a transport shim. It owns **codex-specific
generation doctrine** — its own seed recipe and register anchors, its own cap if evidence diverges,
its own prompt-stress patterns, its own required request fields. Daniel's words: *"seeding law for
codex image gen, required params, logic, what needs to be stressed, and actual run logic may be
different."* The A-vs-B debate is closed and not re-litigated here.

**The line, in one sentence: forge.py owns WHAT the shot needs; the provider owns HOW HARD and IN
WHAT FORM to say it.**

### 3.1 The boundary

| Stays in `forge.py` — shot truth, engine-blind | Moves to / lives in `forge_codex.py` — provider truth |
| --- | --- |
| Slate building: which figures, place, primitives, props and chain parents a shot needs (`cmd_batch` L1595+); reuse-before-regenerate; the C-6 figure-review reuse gate; provenance counters | The **seed cap** the slate is fitted to (§4.7) and any **extra register seeds** the engine needs to hold the look (§3.3) |
| The SEEDING LAW's refusals: a gen that cannot inherit a named figure's rig does not run (`seeding_law_violations` L751-941); the one-seeded-performer law; `anon_foreground` refusal | Reinforcement *beyond* the inheritable minimum — an engine may ask for more/other seeds, never fewer than the law requires |
| The displacement **order** (crowd exemplar → interaction template → tagged prop, L1861-1906) and its never-droppable floor | The displacement **threshold** (the cap value passed in) |
| Seed **roles**: which image is canonical / pose / expression / place / style-anchor, and the ordinal role prose that states it (`seed_roles_text` L1270-1352) | **Stress**: emphasis, repetition, ordering weight and wording of that role prose for this engine (§4.1) |
| Staging reserve/publish + locks (L1092-1143), `validate_png`/`to_png_bytes` (L100-125) | Everything between "here is the assembled text and the seed paths" and "here are validated PNG bytes": adaptation, invocation, harvest, normalization, failure classification |
| The review states, the one-surgical-retry law, `stamp_review.py`, the manifests | The **transport re-issue** (a strictly separate notion, §6) and the engine log rows it emits |
| `assemble_prompt` (L273-290) and the two-voice head/tail shape | The engine-specific tail the provider appends *after* that assembly (§4.3) |

Two consequences worth stating plainly:

1. **The doctrine constant `SEED_CAP = 4` (L381) stops being global truth** and becomes the Gemini
   provider's declared cap (§4.7). The name and value stay in forge.py so existing callers and tests
   are undisturbed.
2. **A codex seeding divergence is a legitimate outcome of this work, not a defect.** If P4/P5
   evidence shows codex needs (say) the canonical alongside a STEP-1 card where Gemini does not, the
   provider declares that and `cmd_batch` honours it — but the divergence must be *measured*,
   registered in SKILL.md's engine section, and covered by a test before it is emitted
   (skills README: prove, then register, then emit).

### 3.2 The gen-time seam

```python
def generate(self, *, prompt_text: str, seeds: list[str], aspect: str,
             image_size: str, name: str) -> tuple[bytes, dict]:
    """Return (complete PNG-or-JPEG bytes, metadata dict). Raises on failure."""
```

- **Returns bytes, not a path.** The probelog sketched `-> local_png_path` (p1 §c). Rejected: a
  path-returning seam makes `cmd_gen` copy a foreign file into staging, duplicating or bypassing
  `_publish_staging_png`'s atomic non-clobbering `os.link` (L1134) and its escape check
  (L1125-1127) — the two mechanisms that make concurrent generators safe. Bytes keep **one** writer
  of staging for both engines. Cost: ~2-6 MB held in memory per image; irrelevant at this scale.
- **`aspect` and `image_size` stay in the signature** even though codex honours neither as a
  parameter (probe D). The codex provider turns them into prose (§4.3) and into the normalization
  target (§4.6); the call site stays engine-blind.
- **`name` is for error strings and log rows only**; a provider never touches `k.staging`.
- **`metadata` is `{}` for Gemini**; the codex row shape is §5.3.
- Call site, replacing L1223 exactly:
  `data, meta = k.providers[item_engine].generate(prompt_text=text, seeds=seeds, aspect=aspect, image_size=size, name=name)`
  with L1224-1226 unchanged beneath it.

### 3.3 The slate-time policy hooks (classmethods — no instance, still $0)

`batch` runs with `Kit(dry=True)` and constructs no provider (§2.3), yet it must fit the slate to the
right engine's law. So slate-time policy is exposed as **classmethods**, importable and callable
without instantiation, with no key, no subprocess and no network:

```python
class Provider:
    @classmethod
    def seed_cap(cls) -> int: ...
    @classmethod
    def register_seeds(cls, shot_facts: dict) -> list[dict]: ...   # extra {path, role, character}
    @classmethod
    def policy_fingerprint(cls) -> str: ...      # cap + register policy, hashed
```

- `GeminiProvider.seed_cap() == SEED_CAP == 4` and `register_seeds() == []` — so every emitted
  Gemini slate is byte-identical to today's.
- `policy_fingerprint()` is what §2.2's mismatch check compares: a `gen --engine` override is
  accepted only when the fingerprints match. **`batch` writes it onto each ITEM, beside that item's
  `engine` — never into a spec-level envelope.** A gen spec is a JSON *list* today
  (`gen` loads it and iterates at L2561; `batch_provenance` reads `for item in spec if isinstance(spec, list)`,
  L2399), so wrapping it in an envelope would silently drop C-11 provenance and break the loader. A
  stale slate is therefore detected per item, which is also the granularity a mixed-engine spec
  (§2.2) needs.
- `cmd_batch` calls these three and nothing else on a provider. It never imports transport code
  paths; the import of `forge_codex` must therefore stay free of side effects (no `shutil.which` at
  import time — binary resolution happens in `__init__`, §4.4).

### 3.4 File layout

```
scripts/forge.py             + ~70 lines: ENGINES/PROVIDERS, --engine (gen+batch), per-item engine,
                               provider dict in Kit.__init__, preflight provider construction,
                               engine-aware cap threading into cmd_batch's displacement walk,
                               the one-line call site, the engine-log append. GeminiProvider (a thin
                               wrapper over nano/ip/url_for) lives here.
scripts/forge_codex.py       NEW ~400-500 lines: CodexProvider — slate-time policy classmethods,
                               prompt adaptation + stress, aspect prose, exec invocation, thread-id
                               capture, harvest, normalization, failure classification, usage capture.
scripts/test_forge_codex.py  NEW — unit tests + the fake-binary fixture (§8).
```

`from forge_codex import CodexProvider` at forge.py's top; the existing tests already do
`sys.path.insert(0, str(Path(__file__).parent))` (`test_forge_hold.py` L6-7), so the sibling import
resolves identically for tests, the CLI and any caller.

---

## 4. Request path

Order inside `CodexProvider.generate`: adapt prompt → build envelope → resolve/verify seeds →
invoke → harvest → validate → normalize → return bytes + metadata. Everything before and after that
call is the existing shared path.

### 4.1 The adaptation + stress layer — where it sits

**Inside the codex provider, downstream of `k.prompt_for(...)` (L1197) and therefore downstream of
`assemble_prompt` (L273-290).** The channel's assembled prompt — bible §2b descriptor + crowd clause
+ rig-hold + authored payload (carrying `seed_roles_text`) + `global_prompt_suffix` — stays the
canonical artifact: it is what `shots.json` authors, what `gen --dry-run` prints (SKILL.md
L162-164), what DSG-lite decomposes (SKILL.md L372) and what a surgical retry overlay does exact-span
replacement against (SKILL.md L191-202). Adapting *before* assembly would break the overlay's
`{from, to}` span matching — the one mechanism that keeps retries surgical.

The layer does four things, in this order:

1. **Idiom translation** (§4.2) — blocking language that this engine renders as literal signage.
2. **Role-prose stress** — the provider may re-emphasize the ordinal seed-role prose forge authored
   (repeat the ordinal, front-load the identity clause, harden "copy only …" wording). It may change
   *emphasis and form*; it may never change *which seed plays which role*, which is shot truth
   (§3.1). The transform is a declared, testable function, not ad-hoc string surgery, and its output
   is printed by the dry run. Initial content: none beyond the guard clause below — stress patterns
   are a P4 finding, and shipping invented emphasis before measuring it is the wording-chase failure
   §7 exists to prevent. **[THIN]** — no probe isolated role-prose stress.
3. **Guard clause + aspect sentence** (§4.3).
4. **Fingerprint** — the adapted text's sha256 goes into the log row, so a frame's exact provider
   text is recoverable after the fact.

**Alternative rejected:** threading an `engine` parameter into `assemble_prompt`. Its docstring
(L275-288) is explicit that the two-voice head/tail shape and last-instruction weighting are a claim
about *this provider*; forking it per engine puts two providers' assumptions inside one doctrine
function and makes every existing prompt-shape test engine-conditional.

Consequence accepted, with a required fix: for codex runs the bytes sent are not the bytes
`gen --dry-run` prints today. So when the resolved engine is codex, the dry-run block at L1203-1213
additionally prints an `----- codex adaptation -----` section — translated spans, stress transform
output, guard clause, aspect sentence, residual-idiom list — keeping the full provider text
reviewable at $0 before a batch. DSG-lite on a codex frame decomposes the **adapted** text, since
that is what the pixels came from; SKILL.md L372 already says "the ASSEMBLED prompt — what forge
actually sent", and the adaptation is now part of what forge actually sent.

### 4.2 Blocking-idiom translation

Probe E2 rendered a literal `TOTE RACK / STAGE-LEFT` sign from "the rack of tote bins stage-left" —
this pipeline's standard authoring idiom, live in the bricks file today (L46: *"…`hold-both-hands`,
in a grey work coat, stage-left, carrying a cardboard box…"*; L47: *"…`carry-by-handle`,
stage-right, stepping out through a glass door…"*). A fixed, ordered, case-insensitive table runs
over the assembled text:

| Pattern (word-boundary, case-insensitive) | Replacement |
| --- | --- |
| `stage[-\s]left` | `on the left of the frame` |
| `stage[-\s]right` | `on the right of the frame` |
| `stage[-\s](centre\|center)` | `centred in the frame` |
| `up\s?stage` | `toward the back of the frame` |
| `down\s?stage` | `toward the front of the frame` |
| `camera[-\s](left\|right)` | `on the (left\|right) of the frame` |
| `off[-\s]?stage` | `outside the frame` |

Two properties it must have: (a) it never touches text inside quotes — the diegetic literals of
SKILL.md L136-138 are load-bearing and must render verbatim; (b) it changes wording only, never
deleting a staging fact, because dropping a load-bearing fact to dodge a rendering defect is the
fidelity violation named at SKILL.md L395-397.

A **residual scan** then runs a wider set (`\bstage\b`, `\bwings\b`, `\bblocking\b`, `\bmark\b` near
a direction word), recording hits as `residual_idiom: [...]` in the log row plus a stderr WARN
naming the shot and span. Not a hard error: the table cannot be proven exhaustive and hard-failing on
prose would block legitimate shots. The list is printed by `gen --dry-run`, so it is reviewable at
$0. **[THIN]** — one observed instance (probe E2); everything past `stage-left/right` is inferred.

### 4.3 Guard clause and aspect sentence

Appended in this order as the final paragraph (probe G2 is the only evidence about steering this
engine with tail text — the house suffix moved ink R−B from −6.5 to +7.9 — so the guard goes at the
tail):

1. **Text allow-list (positive, mechanical).** Extract every quoted literal from the authored
   payload, then state: *"The ONLY words that may appear anywhere in this image are: «MINISCRIBE».
   Every other surface is unlettered — no signage, nameplates, labels, captions, logos, brand marks
   or invented text of any kind."* A positive allow-list rather than another prohibition is the
   skills-README move ("positive/mechanical checks replace prohibitions"): "no unrequested text" is
   already in the `global_prompt_suffix` and probes E and H minted signage anyway, under exactly
   that clause. With no quoted literals it degrades to *"No words, letters, numerals or signage
   appear anywhere in this image."*
2. **The aspect sentence.** Probe D: the model tracks the *literal pixel ratio* more closely than
   the aspect name (1344:768 = 1.750 came back as 1.7500). So state both:
   *"Compose for a W×H pixel frame — an A:B «landscape|portrait» aspect ratio."* Values from the
   canvas table (§4.6). Omitting aspect language yields an arbitrary ratio (probe G1 returned
   1122×1402 on a 16:9-intended shot), so this sentence is **mandatory on every codex call**,
   including STEP-1 figure cards (`2:3`, forge.py L1199 default).

### 4.4 The exec invocation shape

```
<codex_bin> exec --json --sandbox read-only --cd <isolated_tmp_dir> "<envelope>"
   stdin = DEVNULL, timeout = 240s, cwd = <isolated_tmp_dir>, stdout read line-by-line
```

- **Only P1-proven flags.** `exec --json --sandbox <mode> --cd <dir>` is what the probe ran (p1
  probes A/C). Any further flag (repo-check skip, model pin, non-interactive assertion) must be
  probe-verified in P4 before it appears in code. **[THIN]**
- **`--cd` points at a fresh `tempfile.mkdtemp()` outside the repo**, never the kit or video dir.
  p1 finding 7: with `--cd` inside a kb worktree the agent burned tokens and wall-clock trying to
  read `CLAUDE.md`, `governance/agent-rules.md` and `contract.md` before calling the tool. An empty
  temp cwd removes the ambient repo surface. Removed in a `finally`.
- **Sandbox `read-only`, with `workspace-write` as fallback.** Seeds are absolute paths *outside*
  the cwd and P1 only exercised absolute-path seeding under `workspace-write` (probe C). Whether
  `read-only` permits reading arbitrary absolute paths is **[THIN] — P4 must verify**; if not, the
  fallback is `workspace-write` on the empty temp dir, which grants writes only to a directory
  containing nothing. The image lands in the codex images root either way, so no write permission is
  needed for the deliverable.
- **`stdin=DEVNULL`.** Probe A saw `Reading additional input from stdin...` on stderr; a closed
  handle removes any chance of a block.
- **Envelope:** a one-paragraph instruction — *call `image_gen__imagegen` exactly once with this
  prompt and these `referenced_image_paths`; do not read any other file first; report nothing but
  the saved path* — then the adapted prompt and the absolute seed paths. The instruction reduces but
  does not eliminate the detour (p1 finding 7); the empty cwd is the real control.
- **Binary + images root** are module attributes on `forge_codex`
  (`CODEX_ARGV_PREFIX`, `IMAGE_ROOT = ~/.codex/generated_images`), resolved in `__init__` — never at
  import time, which would break §3.3's side-effect-free import — with a fail-loud "codex CLI not
  found on PATH" `SystemExit`. They are module attributes precisely so tests can patch them (§8.1).
- **Timeout 240s** = the standing 4-minute image-gen ceiling; observed band 70-165s (p1 probe I), so
  ~1.5× the slowest observed call. On timeout the child dies with its process group (Windows:
  `CREATE_NEW_PROCESS_GROUP` + `taskkill /T /F`; POSIX: `killpg`) and the call is classified `stall`
  (§6).

### 4.5 Seeds: absolute paths, ceiling, digests

- `resolve_request_seeds` (L943-975) already returns absolute paths — `k.resolve_seed` (L341-348)
  joins against the absolute `k.root`/`k.kit`, and the staged branch joins `k.staging`. The provider
  still applies `os.path.realpath()` and asserts `os.path.isabs`, because p1 hard limit 1 is a
  **pre-render hard rejection** with no normalization: the assert costs nothing, the rejection costs
  a 60k-token round trip.
- **Transport ceiling assert:** `len(seeds) <= 5`, fail-loud, naming the shot (p1 probe F: exactly
  5, server-enforced, clean error, no silent truncation). This is the *transport* ceiling and is
  structurally separate from the provider's doctrine cap (§4.7) — which is why it is an assert and
  not a policy knob.
- **Digests.** `verify_request_seed_digests` (L1021-1029) already runs in `preflight_batch` (L1157)
  for both engines. The codex provider re-hashes each seed immediately before invoking and raises
  `SeedIntegrityError` (L85-87), which the existing handler at L1230-1232 turns into a batch abort.
  **Known gap, stated not papered over:** the Gemini path closes the TOCTOU window by reading the
  checked bytes *into* the request (`ip()` L90-95, per the comment at L1219-1220); the codex path
  hands over a *path* and the codex process opens it at an unknown later moment, so the window is
  "immediately-before-invoke", not "the exact bytes sent". Mitigation: every seed's sha256 is
  recorded in the log row so a post-hoc audit can detect a mid-run change. Inherent to a path-based
  tool contract; not closeable from our side.

### 4.6 Harvest, validation, normalization

**Harvest (fail-loud, snapshot-diff).**
1. Before invoking, snapshot `set(os.listdir(IMAGE_ROOT/<thread_id>))` — empty for a fresh thread
   (the directory does not exist yet), non-empty for a resumed session (§5.2), which is why this is
   a diff and never "the only file present".
2. Read the JSONL stream line by line; capture `thread_id` from `thread.started` and `usage` from
   `turn.completed` (p1 probe A event shapes). `thread_id` is the only structural handle that
   exists — there is no `tool_call`/`tool_result` event (p1 hard limit 4).
3. After `turn.completed`, diff again with a short bounded poll (5 × 1s) to absorb write/close lag.
4. **Exactly one new `*.png`** → success. Zero → `no_image` (§6). More than one → `multi_emit` (§6):
   take none, fail loud, list the paths. **Alternative rejected:** newest-by-mtime wins — it ships
   whichever candidate the model happened to finish last, and there is no evidence about *why* a
   second image would appear (never seen in 8 gens). If P4 shows multi-emit is common and benign,
   that ruling changes with evidence attached.
5. The model's free-text path report is parsed **only** as a cross-check; a mismatch is a WARN in
   metadata, never a decision input (p1: the text varies run to run).
6. The harvested file under `~/.codex/generated_images/` is **left in place**; its path and sha256 go
   into the log row. forge deletes nothing outside the repo.

**Validation.** `validate_png` (L118-125) runs on the harvested bytes *before* normalization —
rejecting ≤1024 bytes and bad magic, the empty/undersized rejection this design owes — and again on
the normalized bytes before returning, so nothing unvalidated can reach `_publish_staging_png`.
`to_png_bytes` (L100-116) still runs at the shared call site (L1224) and is a no-op for PNG bytes.

**Normalization to canvas — the step the Gemini path never needed.** Probe D: ratio is steerable to
~0.2-2%, literal pixel dims are never honored, and the same nominal ask returns a different
resolution every run. Downstream code assumes a stated canvas (SKILL.md L121-132 makes aspect and
resolution doctrine; render composites at a delivery frame). So:

```
target = CANVAS[(aspect, image_size)]
r_err  = |native_ratio / target_ratio - 1|
r_err > 0.05           -> raise RatioError            (failure class 7, §6)
0 < r_err <= 0.05      -> centre-crop the excess axis to the exact target ratio
then                   -> Lanczos resize to exactly (W, H), re-validate, return
```

- Centre-crop-then-resize, never anisotropic stretch: a 2% stretch is invisible on a plate and
  obvious on a face, while a ≤5% crop costs a few percent of the frame edge.
- **`CANVAS` is calibrated to the pipeline's REAL Gemini output, not to a doc approximation.** All
  23 verified 6c2 baseline frames measure **1376×768** (`scratch-codex-image-engine/gemini-baseline/`,
  §7.5), while SKILL.md L130 says "~1344×768". The table entry for `(16:9, 1K)` is therefore
  **1376×768** — matching what render-builder already consumes — with `(2:3, 1K) = 832×1248` and
  `(9:16, 1K) = 768×1344` carried from the doc until measured otherwise, and 2K/4K rows at 2×/4×
  linear. An `(aspect, size)` pair absent from the table is a fail-loud `SystemExit` naming the
  pair, never a guessed canvas. P4 confirms the 2:3 and 9:16 entries against real Gemini frames of
  those ratios before any codex frame of that ratio is promoted. **[THIN]** on those two rows.
- **Where it lives: inside the codex provider**, before returning bytes. Alternative rejected:
  normalizing for both engines in `cmd_gen` — that alters the Gemini byte path (which today writes
  exactly what the API returned) and breaks §2.5.
- **Register consequence, stated not hidden:** SKILL.md L126-132 makes 1K the default *because it is
  the era instrument* — at 2K the same "medium-thick" instruction renders a finer stroke and the
  model spends the extra budget on detail the era never had. Codex renders at its own ~1.5-1.7 MP
  regardless of what we ask (probes C/D/G: 1672×941, 1659×948, 1122×1402), so **a codex frame is
  never rendered at the 1K instrument**; downscaling to the 1K canvas is a post-hoc proxy, not the
  same thing. Permanent, unfixable, and carried into §7's measurement and §9's risks. (Lanczos
  downscale from ~1.2× is mildly detail-suppressing, which pushes *toward* flatness — §7's L3
  measures whether that matters.)

### 4.7 Seed cap — engine-scoped (ruling 1)

**Decision: the doctrine cap becomes provider-declared.** `GeminiProvider.seed_cap()` returns
`SEED_CAP = 4` (L381) — the constant stays in forge.py under its current name and value, so nothing
on the Gemini path moves. `CodexProvider.seed_cap()` **ships at 4 as well**, deliberately: an
identical slate on both engines is what makes A/B comparison meaningful, and no evidence yet says
codex wants a fifth. Its ceiling is 5 (§4.5, transport); raising the doctrine cap to 5 is a
**study/build question** (§7's L2 lever), decided by measurement and registered before it is
emitted.

Why this is not a doctrine weakening: SKILL.md L105 justifies the cap by *dilution* — "past four,
dilution weakens every prior" — which is a claim about how a given model weighs multiple image
priors. That is exactly a provider fact. What stays engine-blind is everything the cap acts on: the
priority order, the never-droppable floor, and the ledger.

**What this does to `cmd_batch` (L1595-1985), precisely:**

1. `cmd_batch` gains an `engine` parameter (from `--engine` or the registry) and resolves
   `cap = PROVIDERS[engine].seed_cap()` once, near the top, alongside the existing per-shot walk.
2. The three `len(seed_roles) > SEED_CAP` comparisons in the displacement walk (L1873, L1881, L1893)
   become `> cap`. **The walk's order and its never-droppable floor do not change** — crowd exemplar
   → interaction template → tagged prop, stopping the instant the slate fits, never dropping the
   place plate/chain parent, the LOCKED §5 lettering exemplar or scene style tile, or any character
   STEP-1 (L1861-1872). Order is shot truth; the threshold is provider truth.
3. The hard error raised when the slate still exceeds the cap keeps naming the true bind — cast
   count against the cap (SKILL.md L177-179) — with the engine's cap value in the message, and it
   still never advises restaging with fewer cast.
4. Extra register seeds declared by `register_seeds()` (§3.3) are appended to the candidate roles
   **before** displacement, so they compete under the same ordered walk rather than jumping the
   floor. A provider cannot smuggle a seed past the law by declaring it.
5. Every emitted item carries its own `engine` **and** `policy_fingerprint` (§3.3 — per item, since
   the spec is a JSON list), so a slate can never be silently executed under a different cap.
6. `assets_omitted` and `why` bookkeeping is unchanged — one displacement ledger, as today.

**The style-tile collision, resolved honestly.** SKILL.md L139-143 and `test_forge_style_tile.py`
make `refs/env/scene-style-tile.png` a **cast-free-only** derived seed: a figure-bearing gen never
takes it, because its cast seeds already carry the register. §7's L2 lever tests exactly that
prohibition for codex — a figure-bearing codex frame with the tile added. The mechanism for it now
exists cleanly (`CodexProvider.register_seeds()`), so the lever needs no hack; but until the study
measures a win, `CodexProvider.register_seeds()` returns `[]` and the channel law holds unchanged
for both engines. Promoting a win to the default is a doctrine change: registered in SKILL.md, a
test added, and Daniel-gated.

---

## 5. Batching + cost shape

### 5.1 What the cost actually is

p1 probe I: every `codex exec` invocation pays 60-115k input tokens (roughly half cache-hit) whether
or not it renders, because each call is a cold process that re-reads the codex-side imagegen skill
doc; wall clock is 70-165s per gen. **Billing is subscription, not metered** — $0 API spend, which
is the arc's premise. So the token tax is not money; it is *rate-limit headroom* on the same
subscription the fleet's codex workers (dispatch-codex) draw from. The batching question is
quota contention, not cost.

At peer scale this matters concretely: a full bricks-sized video is 246 shots, i.e. roughly
15-28M input tokens and 5-11 hours of wall clock in `isolated` mode. That is the number session mode
exists to reduce — not because codex is a budget lane, but because a peer engine has to be able to
carry a whole video.

### 5.2 Default: one turn per image; batching = session reuse, never multi-image turns

**Default mode `isolated` — one `codex exec` process per image.** Reasons, in order:
1. The per-target reservation (`_reserve_staging_output`, L1092-1118) is per-name and taken *before*
   the provider call; N-images-per-process would need one process holding N locks and a mid-process
   failure would have to unwind N reservations.
2. Harvest determinism: "exactly one new PNG" (§4.6) is only decidable per turn. Mapping M emitted
   PNGs onto M shot ids inside one turn means trusting emission order or the agent's free text —
   both explicitly untrustworthy per p1 hard limit 4.
3. Blast radius: one stall loses one frame instead of N.
4. The one-surgical-retry law (SKILL.md L384-393) is per-frame; a batched turn has no per-frame
   boundary to retry at.

**Optional mode `session` — `codex exec resume <thread_id>`, still ONE image per turn.** This is the
right way to buy quota headroom, and it is not multi-image turns: process/prefix overhead amortizes
across turns while every invariant above survives, because each *turn* still produces exactly one
image. The harvest is a snapshot-diff (§4.6 step 1) precisely so a shared per-thread image directory
works unchanged. **[THIN] — `exec resume` was never exercised in P1:** whether `--json` emits
`thread.started` on resume, whether resumed turns keep writing into the same `<thread_id>`
directory, and the realized saving are all P4 measurements. Until P4 measures them, `session` is
specified and implemented but not the default.

CLI: `--codex-session-mode isolated|session` (default `isolated`) and `--codex-session-span N`
(default 8) so one poisoned context cannot degrade a whole act. A resume failure falls back to
`isolated` once, automatically, and records the fallback in the log.

**Alternative rejected:** one turn asking for several images (p1 §c's "one process handling N
shots"). Rejected on harvest determinism alone — it converts a structural one-new-file check into an
ordering assumption over an agent's free text.

### 5.3 Observability: engine log + cost ledger, soft cap, no enforcement (ruling 6)

**In code — the engine log.** The provider returns metadata; `cmd_gen` appends one JSON line per
generated frame to `<kit>/_staging/engine-log.jsonl`, **only when the metadata dict is non-empty**,
so a pure-Gemini run writes nothing new (§2.5). Row shape:

```json
{"ts":"…","engine":"codex-imagegen","name":"L29","thread_id":"019ff…","turn_index":1,
 "session_mode":"isolated","wall_s":107.4,"tokens_in":75742,"tokens_cached":48384,
 "tokens_out":1593,"reasoning_out":742,"native":[1672,941],"canvas":[1376,768],
 "ratio_error":0.0039,"reissues":0,"source_png":"C:/Users/…/019ff…/img_1.png",
 "source_sha256":"…","seed_sha256":{"…":"…"},"adapted_prompt_sha256":"…",
 "residual_idiom":[],"failure_class":null}
```

- `turn.completed.usage` is the authoritative token source (p1 probe A); the human-readable
  "tokens used" text is never scraped.
- At batch end `cmd_gen` prints one extra line for codex frames — total input/cached/output tokens,
  total wall-clock, frames by engine — beside the existing `== N generated, M failed, K skipped ==`
  (L1243).
- The scenes manifest gains an additive `engine` key per entry, which mixed-engine videos (§2.2)
  make load-bearing for review and for any later register audit. `cmd_manifest` (L2405-2456)
  validates only required keys and passes the rest through, so this is schema-compatible — but per
  "prove, then register, then emit" it must be **registered in the scenes-manifest schema doc before
  a producer emits it**.

**Out of code — the cost ledger.** Each run records one row in the day's cost ledger
(`ledgers/cost/<agent>-<date>.tsv`): **$0.00 dollars**, with the run's codex token totals and frame
count in the notes. Written by the **orchestrator**, not by `forge.py` — a generation script must not
perform a coordination write (those go to the `ops` branch under CLAUDE.md's branch rules), and the
single-writer discipline that governs review stamping applies here too. forge's job is to print the
totals and leave the durable row to the step that owns coordination writes.

**Soft cap, no enforcement.** There is no daily generation cap in code and no auto-throttle. A
rate-limit-classed event stops the run loud (§6, class 6) and a human decides. Alternative rejected:
sleep-and-retry backoff like `nano()`'s L76-79 — that loop exists for a metered HTTP API with
documented status codes; inventing quota semantics from zero observed rate-limit events (p1 probe I
saw none across 12 calls) would be a mechanism built on no data.

---

## 6. Retry / failure law mapping

**The doctrine is unchanged.** SKILL.md L384-393: exactly ONE auto-retry per frame, a *fresh gen off
a surgically re-authored prompt*, ruled by the next batch's fresh-eyes pass (L398-403), with
`retry_cause` logged and `suspected_mechanism_layer` recorded when exhausted (L394). This design adds
**no** new content-retry authority. It adds one strictly separate notion — a **transport re-issue**,
the standing 4-minute-ceiling policy's "one re-issue": it re-sends the *identical* adapted prompt
because no image was produced at all. A transport re-issue never counts against the frame's one
surgical retry and never fires when an image *was* produced.

| # | Failure class | Detection | Handling |
| --- | --- | --- | --- |
| 1 | **Contract violation** (relative seed path, >5 seeds, cap/policy mismatch §2.2) | `preflight_batch` / provider assert, before invoking (§4.5) | Hard `SystemExit` at $0 for the whole batch, naming the shot. Never re-issued: deterministic. Mirrors the seeding-law preflight at L1161-1163. |
| 2 | **No image** (0 new PNGs, turn completed) | Snapshot diff (§4.6) | ONE transport re-issue → still 0 ⇒ per-item `ERR no_image` via the existing L1233-1234 handler; batch continues. |
| 3 | **Stall / timeout** (240s, §4.4) | Subprocess timeout, process group killed | ONE transport re-issue → still stalled ⇒ `ERR stall`. |
| 4 | **Non-zero exit / unparseable stream** | Exit ≠ 0, or no `thread.started` line | ONE transport re-issue (a cold-process fluke is plausible) → `ERR exec_failed` with a ≤160-char stderr tail, matching L1234's truncation. |
| 5 | **Multi-emit** (>1 new PNG) | Snapshot diff | NO re-issue. `ERR multi_emit`, paths in the log row. Indeterminate provider state is not re-rolled blind; P4 measures frequency (§4.6). |
| 6 | **Refusal / quota** (turn completes, no tool call; agent text refuses or reports a limit) | 0-PNG path + marker scan of `agent_message` | Classified apart from #2 and **not** re-issued — re-issuing an unchanged refusal is re-rolling an unchanged mechanism, forbidden by SKILL.md L394. `ERR refusal`; a **quota** classification stops the batch loud (§5.3). p1 probe H saw no refusal on the channel's hardest case (a named, convicted real person), so this path is **[THIN]** but must exist. |
| 7 | **Ratio out of tolerance** (>5%, §4.6) | Normalization | `ERR ratio` — no transport re-issue (an image exists; the model mis-framed). Surfaces as a missing frame; re-authoring the aspect sentence is a legitimate *surgical* retry through the normal overlay path. |
| 8 | **Invalid bytes** (≤1024 bytes / bad magic) | `validate_png` L118-125 | `ERR` as today; no survivor is ever written (the L119-120 rationale holds identically). |
| 9 | **Unrequested in-image text** | Not machine-detected. Fresh-eyes fidelity axis (SKILL.md L368-376) + DSG-lite on lettered shots | The ordinary ONE surgical retry, rewriting the allow-list clause (§4.3). A second failure exhausts the frame and records `suspected_mechanism_layer: provider_limitation` (SKILL.md L394) — given probes E and H, the *expected* diagnosis for this engine, and exactly the datum §7 needs. |
| 10 | **Register drift** (gradients, cool ink) | §7's measured battery + the style/taste axis (SKILL.md L377-379) | Never an auto-retry. A calibration finding routed to §7's lever ladder, not re-rolled per frame. |

Two guard rails on the re-issue: (a) **at most one per frame, ever** — `reissues` is in the log row,
so a second failure reads as systematic; (b) a re-issue always starts a **fresh thread** even in
`session` mode, since classes 2-4 mean the session's state is suspect.

---

## 7. Register calibration study — bounded, measured, STOP-and-escalate

Daniel's read: codex leans slightly realistic; the goal is to **hold the 2D flat-cartoon era**; he
judges it calibratable. Ruling 5 sets the standard — peer engine, any shot class — and ruling 4 sets
the floor accordingly (§7.4). Ruling 3 removes the escape hatch: **the register comes from steering
the engine or not at all.** No post-processing pass is permitted, so every lever below acts on what
is sent, never on what came back.

### 7.1 Corpus and sampling

Four shots from `2026-07-28-bricks-fresh`, all of which have verified Gemini baseline frames on disk
(§7.5). Kit read-only; every output to arc staging.

| Shot | Class (from `shots.json`) | Why it is in the corpus |
| --- | --- | --- |
| **L26** | `map-plan-view`, no cast tokens, no `place` | Cast-free plate — the only class that takes the §5 style tile by law (SKILL.md L139-143), and the purest read of prose-only register. |
| **L44** | `personified-character`, one named figure (`ibm-suit`), place `miniscribe-floor` | The single-figure scene: cast seed carries the register, place plate carries continuity. |
| **L33** | `staged-interaction`, two named figures + `handshake` interaction template | Multi-seed composition at the cap — exercises displacement and the two-figure identity case probe E2 covered. |
| **L29** | `personified-character`, one figure + quoted `'MINISCRIBE'` | Lettering-bearing (seeds the §5 lettering exemplar) **and the exact shot P1 probed at G1/G2**, so every codex number here is directly comparable to the probe log's −6.5 / +7.9. |

**n = 2 per (shot, variant) cell.** Engine variance is real and doctrine already says so (SKILL.md
L431: where engine variance is the constraint, generate a candidate batch rather than re-rolling one
prompt serially). A lever counts as moving a metric only when it moves it by **more than the
within-cell spread** measured at L0. Single-sample cells let noise masquerade as calibration.

### 7.2 Metrics — one script, all reproducible

**Measurement rule first: every metric is computed on frames at the SAME canvas.** M2 in particular
is neighbourhood-based and therefore resolution-sensitive, so comparing a native 1672×941 codex
render against a 1376×768 Gemini frame would measure the resize, not the register. Codex frames are
measured *after* normalization (§4.6); baseline frames are already 1376×768.

| ID | Metric | Definition | Target / source |
| --- | --- | --- | --- |
| **M1** | Ink warmth | mean `R−B` over the darkest 3% of pixels by luma — the exact probe-G method, so P1's numbers stay comparable | **+18**, from the style bible's pinned outline `#241a12` (36,26,18). Probe: bare = **−6.5**, house suffix = **+7.9**. |
| **M2** | Flatness | fraction of pixels whose 5×5 neighbourhood luma **range ≤ 4/255**, excluding pixels within 2 px of an edge (Sobel magnitude above the frame's 90th percentile). High = flat cel fills; low = gradients / ambient shading. | The **measured Gemini baseline band** over the 23 frames (§7.5). |
| **M3** | Palette concentration | colours needed to cover 90% of frame area after 32-level-per-channel quantization | Baseline band; era law is "2-3 colour scene palette + one red accent" (`global_prompt_suffix`). |
| **M4** | Red-accent discipline | fraction of pixels within a small RGB radius of `#d7402b` | Baseline band; semantic-only use ⇒ small. |

Not measured: **line weight**. There is no robust single-number stroke-width metric available here,
and inventing one would produce a gate nobody can trust. Line weight stays an eyeball judgement on
the style axis (SKILL.md L377-379) — the study's known blind spot, and the reason §7.4's escalation
packet always carries a side-by-side board rather than only a table.

### 7.3 Lever ladder — ordered, one at a time

| Lever | What it changes | Gens | Why here |
| --- | --- | --- | --- |
| **L0 baseline** | Nothing: the adapted prompt exactly as §4.1-4.3 specifies. | 8 | Fixes each metric's value **and its within-cell spread**; every later claim is relative to it. |
| **L1 tail strengthening** | The tail gains a positive, mechanical flatness clause — *"every fill is a single flat colour; no gradients, no ambient occlusion, no cast shadows, no rim light, no reflections"* — and restates `#241a12` at head **and** tail. ≤2 variants. | ≤16 | Cheapest, reversible, pure prose, and the only lever with evidence behind it: probe G2's suffix alone moved M1 by +14.4. Positive clauses over prohibitions, per the skills README. |
| **L2 style tile as a register seed** | `CodexProvider.register_seeds()` adds `refs/env/scene-style-tile.png` to *figure-bearing* codex frames (cast-free ones already carry it by law). ≤2 variants. | ≤16 | The one untested high-prior lever — the tile is the channel's own pixel register anchor (its role prose grants line weight, `#241a12`, flat-cel render and palette saturation, forge.py L1325-1341). It sits after L1 because it costs a seed slot under the cap (§4.7) and because it tests a prohibition the channel currently holds. |
| **L3 canvas choice** | Re-normalize the *same* renders to a 1K vs 2K canvas and re-measure M2/M3. | 0 | Free. Tests whether the downscale ratio itself buys flatness (§4.6). It changes only the normalization target — an input-side setting, not a retouch — so it is inside ruling 3's line. |

**Forbidden (ruling 3): any post-generation register pass** — palette quantization toward the scene
palette, recolouring the darkest cluster toward `#241a12`, gradient flattening, or any equivalent.
Register comes from steering the engine or not at all. A frame that needs retouching to pass is a
frame the engine did not render on-register, and shipping it would make the review gate measure our
post-processor instead of the engine.

**Hard budget: 48 generations** (L0 + L1 + L2 ≤ 40 at n=2 with ≤2 variants each; 8 spare for a
re-measure). $0 spend; ~2-3 h wall clock at 70-165 s/gen. **No lever gets a third variant** — a third
wording is where an unbounded chase starts, and doctrine already names that failure (3+ failed fixes
⇒ question the architecture, skills README).

### 7.4 Gates and the STOP condition (ruling 4)

- **Promote a lever** only if it improves its target metric by more than the L0 within-cell spread on
  at least 3 of the 4 shots, and regresses no other metric beyond that spread.
- **Stop a lever early:** if a variant regresses M1 by more than 3 against the best lever so far,
  stop that lever — do not rescue it with a third wording.
- **PASS floor (peer standard):** `M1 ≥ +15` **and** `M2 ≥ (Gemini baseline M2 − 5 points)`, with
  M3/M4 inside the baseline band. Both numbers are Daniel's ruling and are deliberately close to the
  Gemini reference: a peer engine that any shot class can route to has to sit beside Gemini frames in
  one cut, so the floor is a peer floor, not a viability floor. Passing sends the study to the P5
  live slice with the winning lever frozen into the adaptation layer and the winning configuration
  written into SKILL.md's engine section before production use — prove, then register, then emit.
- **STOP-and-escalate** once L1 and L2 are both exhausted without clearing that floor. The packet is:
  the full metric table (shot × lever × rep), a side-by-side board (Gemini reference vs best codex
  variant per shot, published as an artifact with lightbox), the levers tried with their measured
  deltas, and one recommendation of exactly two available outcomes —
  **(a) accept the measured difference for a named shot class** (Daniel rules whether that class may
  route to codex, knowing the numbers), or **(b) park the engine**. Post-processing is not on the
  menu (ruling 3). **No further generation happens after the packet until he rules**: re-rolling an
  unchanged mechanism is forbidden (SKILL.md L394), and "more wordings" after two exhausted levers is
  exactly that.
- Honest note on the odds: the floor is nearly double probe G2's measured +7.9, so L1+L2 have real
  work to do. That is intended — a lower bar would license a second-class register under a peer-engine
  label.

### 7.5 Baseline — CLEARED

`scratch-codex-image-engine/gemini-baseline/` holds **23 verified 6c2 Gemini frames** (L26-L50,
read-only copies from the main checkout) plus `SHAS.txt` recording each frame's sha256, byte size and
provenance line. Measured facts already extracted: every frame is **1376×768**, which is what fixes
§4.6's `(16:9, 1K)` canvas entry to the pipeline's real output rather than SKILL.md L130's
approximate "~1344×768".

How they are used:
- **Band:** M2/M3/M4 baselines are the mean ± spread across all 23 frames — a band, not a point, so a
  codex frame is judged against the era's real variance.
- **Pairing:** for the four corpus shots (L26, L33, L29, L44) the *same shot's* Gemini frame is the
  paired reference in the escalation board and in per-shot deltas.
- **Integrity:** the study re-verifies each baseline sha against `SHAS.txt` before measuring, so a
  silently altered reference can never move a gate.
- P4 additionally uses the 23 to sanity-check the metric script itself: a metric whose Gemini band is
  absurdly wide is a broken metric, not a finding.

---

## 8. Testing strategy

### 8.1 The fake codex binary fixture

Contract of `_fake_codex.py` — written by the test into a temp dir and invoked as a subprocess
exactly as the real binary would be:

- **Invocation:** tests patch module attributes on `forge_codex` —
  `CODEX_ARGV_PREFIX = [sys.executable, str(fake_py), "--mode", "<mode>"]`,
  `IMAGE_ROOT = <tmp>/generated_images`, and `TIMEOUT_S = 2` for stall cases. The provider builds its
  command as `CODEX_ARGV_PREFIX + ["exec", "--json", "--sandbox", …, "--cd", cwd, envelope]`, so the
  fake receives the **real argv tail** and can assert on it (flags, cwd, envelope contents).
  **Alternative rejected:** an environment-variable override (`FORGE_CODEX_BIN`). An env var that
  redirects which binary a production script executes is a code-execution surface existing purely
  for tests; module attributes are patchable with zero production surface, and the test files already
  import the module directly (`test_forge_hold.py` L6-7).
- **Output:** real JSONL on stdout in the P1-observed shape —
  `{"type":"thread.started","thread_id":"<deterministic id>"}`, `turn.started`,
  `{"type":"item.completed","item":{…"agent_message"…}}`, `{"type":"turn.completed","usage":{…}}` —
  and a **real PIL-generated PNG** of a chosen size with a known dark-ink colour (so the §7 metric
  code is unit-testable against a frame whose M1 is known by construction) dropped into
  `IMAGE_ROOT/<thread_id>/`.
- **Contract enforcement:** in every mode the fake first parses the envelope and fails like the real
  tool if a seed path is relative (`AbsolutePathBuf deserialized without a base path`) or if more
  than 5 paths appear (`referenced_image_paths must contain at most 5 paths`), so our asserts are
  tested against the real error strings (p1 hard limits 1-2).
- **Failure-mode switches (`--mode`):** `ok` · `ok_portrait` · `wrong_ratio` (4:3 for a 16:9 ask) ·
  `no_image` · `two_images` · `tiny_png` (200 bytes) · `stall` · `nonzero_exit` · `bad_json`
  (truncated line) · `no_thread_event` · `refuse` (completes with a refusal message, no image) ·
  `quota` (completes reporting a limit) · `resume_ok` (a second turn writing into the same thread
  dir, for session-mode harvest).

### 8.2 New test file — `test_forge_codex.py`

Plain asserts, no pytest, run as `py -3 .claude/skills/image-generation/scripts/test_forge_codex.py`
(house style, `test_forge_hold.py` L2):

1. **Idiom table** — `stage-left/right/centre`, `upstage`, `camera-left` translated; quoted literals
   untouched; no staging fact deleted (the same nouns survive). Uses L46/L47's real prompt text.
2. **Residual scan** surfaces an untranslated idiom into `residual_idiom` + WARN, and does not raise.
3. **Allow-list clause** built from quoted literals (`'MINISCRIBE'` on L29); degrades to the no-words
   form when the payload quotes nothing.
4. **Aspect sentence + `CANVAS`** — exact strings for `(16:9,1K)` = 1376×768, `(2:3,1K)`,
   `(9:16,1K)`; an unknown `(aspect,size)` raises naming the pair.
5. **Seeds** — a relative path raises before invoking; 6 seeds raise; absolute Windows paths survive
   `realpath`; a mutated seed raises `SeedIntegrityError`.
6. **Harvest** — fresh thread ⇒ one new PNG accepted; pre-existing files in the thread dir ignored
   (snapshot diff); `two_images` ⇒ `multi_emit` listing both; `no_image` ⇒ exactly one re-issue then
   `ERR`; a disagreeing reported path ⇒ WARN only.
7. **Failure classes 2-8** each map to the documented class, message and `reissues` count; `refuse`
   and `quota` are **not** re-issued and `quota` stops the batch.
8. **Normalization** — 1659×948 ⇒ exactly 1376×768, crop-then-resize (assert the cropped
   intermediate's ratio); a 4:3 render for a 16:9 ask raises `RatioError`; returned bytes pass
   `validate_png`.
9. **Engine log** — exactly one row per generated frame with every documented key; **zero rows** for
   a Gemini frame in the same batch.
10. **Session mode** — `resume_ok` harvests turn 2 from the shared thread dir; a resume failure falls
    back to `isolated` once and records it.
11. **Dry run** — `gen --dry-run --engine codex-imagegen` prints the assembled prompt **and** the
    codex adaptation block, and invokes no subprocess (assert the fake was never run).
12. **Slate-time policy hooks are instance-free** — `seed_cap()`, `register_seeds()` and
    `policy_fingerprint()` are callable on the class with no key present, no binary on PATH and no
    subprocess spawned; importing `forge_codex` performs no side effects.
13. **Engine-scoped cap threading** — with a stub provider declaring `seed_cap() == 5`, a slate that
    at cap 4 drops the crowd exemplar (L1873-1880) keeps it, and the displacement `why` /
    `assets_omitted` entries change accordingly; at cap 4 the walk's output is byte-identical to
    today's. Asserts the **order** and the never-droppable floor are untouched by the cap change.
14. **`register_seeds()` competes under the walk** — a declared extra register seed that pushes the
    slate over the cap is displaced by the ordinary ordered walk, never by dropping a locked seed.
15. **Per-item engine + mismatch refusal** — item `engine` beats `--engine` beats registry;
    `gen --engine X` over items stamped `Y` with a different `policy_fingerprint` raises naming the
    shots and telling the operator to rebuild; with equal fingerprints it is accepted and logged.
16. **Mixed-slate preflight** — a spec naming both engines constructs both providers in
    `preflight_batch`; with `GEMINI_API_KEY` absent it fails **before** the first provider call.

### 8.3 Cases added to existing files (deliberately few)

- **`test_forge_seed_requirement.py`** (already imports `Kit` + `cmd_gen`, already exercises the live
  path at L1050-1110): (a) the default engine is still `gemini-3-pro-image` from the registry and the
  key still loads at `Kit(...)` construction with the same exception when missing;
  (b) `Kit(..., engine="codex-imagegen")` constructs with **no** `GEMINI_API_KEY` present;
  (c) a Gemini `cmd_gen` run with the provider's `generate` patched produces identical staged bytes,
  lock/publish sequence and report strings to before the change.
- **`test_forge_style_tile.py`**: one case asserting the §5 tile law is engine-independent as shipped
  — a cast-free codex gen still derives the tile, a figure-bearing one still withholds it — so §7's
  L2 lever can never leak into production doctrine by accident.
- **No other test file changes.** That is itself an assertion: if this engine forces edits to
  `test_forge_hold.py`, `test_forge_figures.py`, `test_forge_place_and_gates.py`,
  `test_forge_seed_roles_and_delta.py`, `test_forge_interaction_and_lettering.py`,
  `test_forge_prop_guard.py` or `test_forge_surgical_retry_and_zones.py`, the seam leaked and the
  design is wrong.

### 8.4 P5 live-slice acceptance

Slice = **6 shots** from `2026-07-28-bricks-fresh`, spec built by the real `forge.py batch`, kit
read-only, **all outputs to arc staging** (never the video's `assets/`). Shots, all with baseline
frames: **L26** (cast-free plate), **L44** (single figure), **L33** (two figures + interaction
template), **L29** (lettering-bearing), **L46** (declared crowd + seeded performer + a literal
"stage-left" in the authored prose — the idiom translation's live test), **L31** (a `delta` beat, so
the chain-parent seeding path runs). Acceptance is all of:

- **A. Mechanics.** 6/6 staged PNGs at exactly 1376×768; exactly one new PNG per call; 0 contract
  violations; ≤1 transport re-issue across the slice; 0 files written outside arc staging and the
  engine log.
- **B. Observability.** One complete engine-log row per frame with `usage` from `turn.completed`; the
  totals line printed; one $0 cost-ledger row recorded by the orchestrator (§5.3).
- **C. Register.** M1-M4 measured on all 6 against the baseline band and ruled by §7.4's floor
  (M1 ≥ +15, M2 within 5 points).
- **D. Review.** A fresh-eyes pass on the three axes (SKILL.md L356-379) with honest states,
  **explicitly counting unrequested-text defects** — the primary evidence on the known compatibility
  gap (p1 risk 2), reported as a number for Daniel, not a verdict we form.
- **E. Gemini regression.** One shot re-run on the default engine in the same session: valid frame,
  unchanged report strings, zero engine-log rows.
- **F. Mixed slate.** A 2-shot spec with one `gemini-3-pro-image` item and one `codex-imagegen` item
  runs end to end: both frames land, the log holds exactly one row, `scenes/manifest.json` records
  the per-frame `engine`, and the same spec with the Gemini key removed fails at preflight, at $0.
- **G. Spend + boundaries.** $0 API spend; `.env` never read on the codex path; the main checkout
  untouched; baseline shas re-verified unchanged.

Explicitly **not** acceptance: "as good as Gemini". That is §7.4's measured floor plus Daniel's taste
ruling; no worker declares it.

---

## 9. Risks + what returns to Daniel

### 9.1 Risks carried into the build

1. **The register may not clear a peer floor.** M1 ≥ +15 is nearly double probe G2's +7.9, and
   ruling 3 removes post-processing as a fallback. The honest outcome distribution includes "park
   it". The study is deliberately cheap (≤48 $0 gens, ~2-3 h) so this is discovered fast.
2. **Mixed-engine register consistency rides on review.** Ruling 2 allows per-shot mixing in v1 and
   no mechanism refuses a mixed slate; the fresh-eyes style/taste axis and the human board are the
   only guards against two registers inside one cut. **Live tension, stated once:** mixing is legal
   *today*, while the measured register gap is *also* today's fact (probe G) — so until §7's study
   clears the floor, any mixed video is review-guarded territory and should be a deliberate,
   eyes-open choice, not an incidental one. The `engine` key on each manifest entry exists so that
   choice is auditable after the fact.
3. **Unrequested in-image text is routine, not occasional** — every gen probe produced at least one
   instance, including unprompted (probe H's `DEFENSE COUNSEL` nameplate). The allow-list clause
   (§4.3) is an untested mitigation. If it does not hold, the fidelity axis becomes the bottleneck
   and every codex frame carries extra review load.
4. **Permanent resolution-instrument mismatch** (§4.6): codex renders at its own ~1.5-1.7 MP; the 1K
   era instrument cannot be requested, only approximated by downscale.
5. **An LLM sits between our prompt and the tool.** Nothing guarantees the agent passes our text
   verbatim to `image_gen__imagegen`; it could paraphrase and we would never see it (no structured
   tool-call event, p1 hard limit 4). Never observed as a defect, structurally unverifiable from our
   side. **[THIN]**
6. **CLI contract drift.** Everything is pinned to `codex-cli 0.146.1` behaviour — event names, the
   images path, the error strings, the flag set — with no stability guarantee; an upgrade can
   silently break harvest. Mitigation: the fake-binary fixture encodes the observed contract, so a
   re-probe against a new CLI version is a cheap diff — but it must be *run*, not assumed.
7. **Seed TOCTOU** (§4.5) — inherent to a path-based tool contract.
8. **Wall-clock at peer scale.** 70-165 s/frame means a full 246-shot video is 5-11 h in `isolated`
   mode; `session` mode's saving is unmeasured (**[THIN]**, §5.2). Peer use may be gated by patience
   before it is gated by register.

### 9.2 Rulings on record (previously open questions)

| Was open | Ruled |
| --- | --- |
| Placement A vs B | **A, widened** — the provider owns codex generation doctrine, not just transport (§3). |
| Mixed engines in one video | **Allowed per-shot in v1**; review carries the consistency burden (§2.2, §9.1.2). |
| Post-processing the register | **Forbidden** — steer the engine or park it (§7.3). |
| The register floor | **M1 ≥ +15, M2 within 5 points of baseline** (§7.4). |
| What codex is *for* | **A full peer engine for any shot class**; routing is taste/A-B, never a cheap-bulk lane (§1, §5.2). |
| Quota policy | **Soft cap + ledger, no enforcement**; rate-limit ⇒ stop loud, human decides (§5.3). |

### 9.3 What comes back to him later, with evidence attached

These are not open questions now; they are gates that fire only if the measurements say so, and each
arrives with numbers rather than a proposal:

1. **Raising `CodexProvider.seed_cap()` to 5** — only if §7's L2 shows the fifth slot buys register,
   registered in SKILL.md with a test before emitting (§4.7).
2. **Promoting the style tile to figure-bearing codex frames** — the same evidence bar; it changes a
   channel law currently held by `test_forge_style_tile.py` (§7.3 L2).
3. **The §7.4 escalation packet**, if L1+L2 fail the floor: accept the measured difference for a
   named shot class, or park the engine (those two only).
4. **Enabling `session` mode by default**, once P4 has measured resume behaviour and the real token
   saving (§5.2).

---

*Nothing in this spec has been built. Every generation it describes is a $0 subscription call; no API
spend is authorized anywhere in this arc.*
