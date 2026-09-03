# creator-001: Tonight Through the expansion-02 Eye Gate

> Implementation plan for `creator-001`, covering P1, P2, P2R, P3 through the
> eye-gate stop, and the dependency-parallel P4b/P4e/P4f work only.

**Goal:** Produce a deterministic, safety-first 60-cell identity expansion batch,
prove the offline build and lifecycle machinery, run it only after independent
review and human spend approval, and stop with a blinded board awaiting a human
eye-gate decision.

**Architecture:** Keep persona configuration under the persona, generic lifecycle
and generation code under `pipeline/expand`, reusable identity scoring under
`pipeline/train`, and operator-visible gating in the existing QA tools. A tracked
`batch.json` is the durable state machine; ignored image pools and blind keys are
large or sensitive local artifacts. The six pod manifests remain ordinary strict
RunPod harness manifests and inherit the already-live model, ComfyUI, and custom
node blocks verbatim.

**Tech stack:** Python 3, pytest, JSON-compatible YAML, Pillow, numpy, existing
RunPod harness, Markdown agent declarations, HEARTBEAT YAML frontmatter, PowerShell.

**Governing design:** Current v3 at `0e93ad63`, folding
`REVIEW-2026-09-03-creator-001-design.md` and `REVIEW2-2026-09-03-creator-001-design.md`.

**Already complete:** P0 landed in `4efea0de` and `f5ba643b`; the harness suite
reported 152 passing tests. P0R is still an external prerequisite for live work.

### Execution graph

| Group | Work | Dependency | May spend or publish? |
|---|---|---|---|
| A, parallel | Task 1 / P1 | Own approved T2 build card | No |
| A, parallel | Task 2 / P4b | Own approved T2 build card | No |
| A, parallel | Task 3 / P4e | Own approved T2 build card | No |
| A, parallel | Task 4 / P4f | Own approved T2 build card | No; leave unarmed |
| B | Task 5 / P2 | P1 + P0R + own T2 build card | No; dry-run only |
| C | Task 6 / P2R | P1 + P2 + own T2 build card | No; independent review |
| D | Task 7 / P3 | P0R + P2R + T2 spend approval | Yes, bounded; then STOP |

Tasks 1–4 are dependency-independent and can be assigned in parallel, but each
worker must use a non-overlapping file list and must not commit. The integrating
executor runs each task's verification and creates the exact commit shown. P2R is
deliberately after P2: it reviews the complete offline implementation and is the
last software gate before P3. This follows the work order even though the design's
phase table describes P2R before P2.

### Global constraints

- Start every execution session with `python scripts/preamble.py`; stop on failure.
- Read `CLAUDE.md`, `governance/agent-rules.md`, the figment `_index.md`, `STATE.md`,
  `contract.md`, `MANDATE.md`, and `pipeline/GUARDRAILS.md` before acting.
- Execute each build phase only under its own boss-issued T2 card. T2/T3 approval
  and ops writes stay with the authorized operator; a plan/review is not approval.
- Never print, store, or pass a RunPod token in a command. The harness reads the
  ambient credential.
- No network volume. Each shard uses a fresh ephemeral pod and the harness's
  termination-plus-absence verification.
- All prompts depict an unambiguously adult fictional person in fully opaque,
  intact clothing. Never name or imitate a real person.
- The safety axes are exactly `adult_read`, `garment_integrity`, and
  `real_person_resemblance`. Missing or malformed safety judgments fail closed.
- Automated scores remain raw observations. They never route pass/fail or promote
  an image; deterministic no-face detection is the sole automated quarantine.
- Human approval remains a distinct, current gate tied to the reviewed artifact's
  SHA-256. A stale gate cannot approve changed content.
- Never commit images, anchors, blind keys, rendered boards, staged uploads, or
  live harness output directories. Commit only the tracked metadata named below.
- Do not weaken a test, invent a gate, manufacture a review, or infer approval from
  the absence of objections.
- Each task below is a separate commit. Before every commit, inspect
  `git status --short` and stage only that task's exact files.

---

## Task 1: P1 — Persona contract, lifecycle state, raw scoring, and human gates

**Files**

- Create: `orgs/figment/pipeline/persona.py`, `pipeline/gates.py`,
  `pipeline/expand/__init__.py`, and `pipeline/expand/batch_state.py`
- Create: `orgs/figment/personas/creator-001/persona.yaml`
- Create tests: `pipeline/tests/test_persona.py`, `pipeline/tests/test_gates.py`,
  and `pipeline/expand/tests/test_batch_state.py` under `orgs/figment/`
- Modify: `orgs/figment/pipeline/train/identity_check.py` and its test
- Modify: `orgs/figment/pipeline/qa_stamp.py`, `blind_pool.py`, and
  `build_grading_board.py`, plus each existing test under `pipeline/tests/`
- Modify: `orgs/figment/personas/creator-001/identity-spec.md` and `.gitignore`
- Move locally/ignored from `personas/anchors/gemini-batch-01/` to
  `orgs/figment/personas/creator-001/anchors/`: exactly g01, g02, and g07

The source files are g01.jpg, g02.jpg, and g07.jpg; move bytes without recompression.

### Step 1.1: Lock the ignored-artifact boundary

Add narrowly scoped ignore entries. The source directory these anchors move out of,
`personas/anchors/gemini-batch-01/` at the repo root, is untracked today and holds
g01-g08; only g01, g02, and g07 move out, so the repo-root path needs its own rule
or g03-g06/g08 stay behind as untracked, uncovered files:

```gitignore
personas/anchors/
orgs/figment/personas/*/anchors/
orgs/figment/personas/*/batches/*/images/
orgs/figment/personas/*/batches/*/rejected/
orgs/figment/personas/*/batches/*/blind/
orgs/figment/personas/*/batches/*/blind-key.json
orgs/figment/personas/*/batches/*/board.html
orgs/figment/pipeline/*/runs/_uploads/
orgs/figment/pipeline/*/runs/out/
```

Move only g01, g02, and g07. Verify all three are ignored, and that the repo-root
source directory is ignored too:

```powershell
git check-ignore -v orgs/figment/personas/creator-001/anchors/*
git check-ignore -v personas/anchors/gemini-batch-01/*
git status --short
```
Expected: three `git check-ignore` rows for the destination, eight for the source;
`git status --short` shows no anchor under either `orgs/figment/personas/*/anchors/`
or the repo-root `personas/` path.

### Step 1.2: Test and implement the persona loader

Use the repository's existing YAML loader instead of creating a second permissive
parser. Expose these interfaces:

```python
def load_persona(path: Path, *, require_assets: bool = True) -> dict: ...
def validate_persona(data: dict, *, base_dir: Path,
                     require_assets: bool = True) -> None: ...
```

Write the failing contract test first:

```python
persona = load_persona(PERSONA)
assert names(persona["identity"]["references"]) == ["g01", "g02", "g07"]
assert product_sizes(persona["grammar"]) == (5, 2, 4, 5)
assert persona["grammar"]["allocation"]["replicate_scope"] == "half-body-strata-only"
assert persona["identity"]["floor"]["anchor_cosine_p5"]["status"] == "uncalibrated"
assert persona["identity"]["floor"]["min_face_px"] == {"status": "uncalibrated", "value": 600,
    "calibration_set_sha": None, "locked_by_gate": None}
```

Also test unknown top-level keys, duplicate references, missing assets, invalid
allocation totals, unsupported angle/distance/light tokens, and a relative path
that escapes the persona directory. `require_assets=False` is allowed only for a
pure schema test; the production default is fail-closed.

Create `persona.yaml` as JSON-compatible YAML. Record the unresolved Instagram
handle, account reference, disclosure verification, and readiness record as null
or `unverified`; do not invent operator data. Use `abg-glam-v1` only as an internal
register ID. The locked banned phrases from look-spec §4 must never be prompt text.

Update `identity-spec.md` so the canonical reference order and immediate next step
say g01, g02, g07 and clothed expansion. Preserve historical provenance.

### Step 1.3: Test and implement the append-only batch state machine

Expose a small pure core plus atomic persistence:

```python
def new_batch(*, batch_id, persona_id, allocation_sha256, cells) -> dict: ...
def next_state(current_state, *, score=None, ruling=None, selected=False, gate_current=False) -> str: ...
def record_pod_run(batch, row) -> dict: ...
def require_strata_coverage(cells, selected_ids, required_strata) -> None: ...
def apply_batch(path, transform) -> dict: ...
def mark_batch_stage(batch, stage) -> dict: ...
```

`mark_batch_stage` writes the batch-level `stage` field (distinct from each cell's own
`next_state` lifecycle) through a strictly forward-only ordered enum:
`BATCH_STAGES = ("building", "generated", "scored", "awaiting-eye-gate-a", "gate-a-ruled")`.
`new_batch` initializes `stage: "building"`. Any call that does not advance to the
next enum value (a skip, a repeat, or a move backward) raises before any write.
Add the `batch_state.py mark-stage --batch ... --stage ...` CLI alongside `apply`,
used by Task 7.

Write a parametrized transition test before implementation:

```python
@pytest.mark.parametrize(("state", "kwargs", "expected"), TRANSITION_CASES)
def test_allowed_transitions(state, kwargs, expected):
    assert next_state(state, **kwargs) == expected
```

`TRANSITION_CASES` must spell out generated→scored, no-face→quarantined,
parked→scored, safety-failed→quarantined, verified selected/unselected→curated or
culled, culled→curated, and curated+current-gate→approved.

Add negative tests proving:

```python
def test_raw_score_never_promotes_or_culls(): ...
def test_illegal_terminal_duplicate_cost_and_coverage_cases_fail_closed(): ...
def test_apply_batch_is_atomic_when_transform_raises(): ...
```

Write a parametrized batch-stage transition test before implementation, alongside
the cell-level one:

```python
BATCH_STAGE_CASES = [
    ("building", "generated", True),
    ("generated", "scored", True),
    ("scored", "awaiting-eye-gate-a", True),
    ("awaiting-eye-gate-a", "gate-a-ruled", True),
    ("building", "scored", False),          # skip
    ("scored", "building", False),          # backward
    ("gate-a-ruled", "scored", False),      # backward past terminal
    ("building", "building", False),        # no-op repeat
]

@pytest.mark.parametrize(("stage_from", "stage_to", "ok"), BATCH_STAGE_CASES)
def test_mark_batch_stage_is_forward_only(stage_from, stage_to, ok, batch):
    batch["stage"] = stage_from
    if ok:
        assert mark_batch_stage(batch, stage_to)["stage"] == stage_to
    else:
        with pytest.raises(ValueError):
            mark_batch_stage(batch, stage_to)
```

`batch.json` contains schema version, persona ID, batch ID, allocation hash, cells,
append-only pod-run rows, aggregate cost, cell-level lifecycle state, a batch-level
`stage` (see `mark_batch_stage` above), and timestamps. Cell
records keep generation provenance, raw scores, human rulings, and selection
separate. Never overwrite an earlier pod-run row or human ruling.
Add the `batch_state.py apply --batch ... --scores ...` CLI used by Task 7.

### Step 1.4: Make automated identity scoring explicitly raw-only

Preserve existing embeddings/metrics. Add `--raw-only` and mutually exclusive
persona/batch inputs alongside the legacy anchor/images CLI; write observations but
no `rulings.json` or threshold state. Include `face_detected`, face dimensions,
anchor-cosine values, and DINO similarity when available (existing behavior).
Add three new, concretely implemented raw metrics computed on the detected face
crop, using Pillow + numpy (no new heavy dependency):

```python
def compute_raw_metrics(face_crop_rgb) -> dict: ...
```

- `laplacian_variance`: convert the crop to grayscale, convolve with the discrete
  3x3 Laplacian kernel `[[0,1,0],[1,-4,1],[0,1,0]]` (`PIL.ImageFilter.Kernel` or an
  explicit `numpy` 2D convolution), and report `float(numpy.var(result))` — the
  standard blur-detection statistic; low variance means a blurry crop.
- `clipped_highlight_fraction`: the fraction (0.0-1.0) of grayscale pixels at or
  above 250/255.
- `local_luminance_variance`: split the grayscale crop into 16x16 tiles, take each
  tile's `numpy.var`, and report the mean of those per-tile variances.

Unsupported observations (no detected face, or an embedder unavailable) are null
with an explicit `unavailable_reason`, never an inferred pass or a silently omitted
key.

Write these tests first:

```python
out = evaluate(ANCHOR, IMAGES, tmp_path, *fake_embedders, raw_only=True)
assert out["mode"] == "raw-only" and not (tmp_path / "rulings.json").exists()
assert set(out["images"][0]) >= {"image_id", "face_detected", "metrics"}
assert "pass" not in json.dumps(out).lower()

def test_raw_metrics_are_real_numbers_on_a_synthetic_face_crop():
    crop = synthetic_face_crop(sharp=True, highlight_fraction=0.10)
    metrics = compute_raw_metrics(crop)
    assert metrics["unavailable_reason"] is None
    assert isinstance(metrics["laplacian_variance"], float) and metrics["laplacian_variance"] > 0
    assert 0.0 <= metrics["clipped_highlight_fraction"] <= 1.0
    assert isinstance(metrics["local_luminance_variance"], float) and metrics["local_luminance_variance"] >= 0
    blurred = synthetic_face_crop(sharp=False, highlight_fraction=0.10)
    assert compute_raw_metrics(blurred)["laplacian_variance"] < metrics["laplacian_variance"]
```

`synthetic_face_crop` is a small deterministic fixture (e.g. a checkerboard vs. a
flat-blurred variant of the same array) built with numpy, not a real photo — the
point is to exercise the arithmetic, not face detection.

Do not delete legacy behavior used by existing callers. Make raw-only the required
mode for expansion-02 and document its output schema in the module help text.

### Step 1.5: Expand QA stamping to seven axes and fail closed on safety

The complete human rubric is:

```python
QUALITY_AXES = ("identity", "realism", "hands", "lighting")
SAFETY_VALUES = {"adult_read": {"pass", "ambiguous", "fail"},
                 "garment_integrity": {"pass", "fail"},
                 "real_person_resemblance": {"clear", "flag"}}
```

Keep `review_status` orthogonal to the axis values. A safety `fail`, `ambiguous`,
or `flag` produces `safety_failed: true` for downstream quarantine. A parked item
remains scored. Missing axes and unknown enum values raise before any atomic write.

Add tests for a complete pass, each safety failure spelling, each missing safety
axis, an unknown value, a parked item, atomic persistence, and legacy input with
no safety axes failing closed rather than silently passing.

Update blind-pool failure taxonomy so reveal reports can represent all seven axes;
do not reveal arm or source path in the blind manifest itself.

### Step 1.6: Put the exact rubric on the grading board

The board remains read-only: it displays the anonymous image ID and rubric, but
does not write a ruling. In blind mode it must hide source path, arm name, original
filename, and allocation cell metadata. Extend `build_grading_board.py`'s existing
`build(images, title, subtitle, blind, max_w, quality, budget_mb)` to also render a
fixed, unconditional seven-axis rubric legend (`ALL_SEVEN_AXES` — the four
`QUALITY_AXES` plus the three `SAFETY_VALUES` keys) on every card; this is a legend
of labels for the human grader, not a ruling input, so no new parameter or call-site
change is needed elsewhere. Use the module's existing `load_manifest` and `build`
functions directly rather than inventing a new `render_board` entry point.

Write a rendered-HTML test:

```python
images = load_manifest(BLIND_MANIFEST)
random.Random(20260903).shuffle(images)  # mirrors main()'s own blind-mode shuffle
html, _ = build(images, "creator-001 expansion-02 — GATE A", "60 image(s)",
                 blind=True, max_w=1600, quality=85, budget_mb=20.0)
assert all(axis in html for axis in ALL_SEVEN_AXES)
assert "source_path" not in html and "expansion-02=" not in html
assert "img_0001" in html
```

### Step 1.7: Test SHA-bound gate records

Expose:

```python
def sha256_file(path) -> str: ...
def write_gate(path, *, gate_id, subject_path, decision, decided_by, decided_at,
               reasons=(), approval_token_ref=None) -> dict: ...
def gate_is_current(gate, subject_path) -> bool: ...
```

Test atomic write/hash, exactly `verified|parked`, mandatory human identity/time,
stale-subject rejection, and optional opaque approval reference. Reject every other
decision. This helper is not called tonight before the eye decision.

Run the complete P1 verification:

```powershell
py -3 -m pytest `
  orgs/figment/pipeline/tests/test_persona.py `
  orgs/figment/pipeline/expand/tests/test_batch_state.py `
  orgs/figment/pipeline/tests/test_gates.py `
  orgs/figment/pipeline/train/tests/test_identity_check.py `
  orgs/figment/pipeline/tests/test_qa_stamp.py `
  orgs/figment/pipeline/tests/test_blind_pool.py `
  orgs/figment/pipeline/tests/test_build_grading_board.py -q
```
Expected: all selected tests pass; no image or secret appears in `git status`.

Commit after integration: `feat(figment): add creator lifecycle and safety schemas`.

---

## Task 2: P4b — Content taxonomy and bounded format templates

**Files**

- Create: `orgs/figment/pipeline/content/taxonomy.yaml`
- Create: `orgs/figment/pipeline/content/carousel-templates.yaml`
- Create: `orgs/figment/pipeline/content/reel-templates.yaml`
- Create: `orgs/figment/pipeline/content/tests/test_content_data.py`

This task is dependency-independent from P1, not authorization-independent. Run it
only under its own T2 build card; an opposite-runtime reviewer checks the inert data.

### Step 2.1: Encode and test the seven content types

Use JSON-compatible YAML and parse it with `json.loads` in the test. Encode:

- A: persona at angles
- B: outfit
- C: room/place
- D: food/drink
- E: flatlay
- F: aesthetic filler
- G: motion

Record the target weekly mix: three reels, three carousels, one single; fourteen
stills and three videos. Record portfolio weights A=36, B=21, C=21, D=14, E=7;
F is substitution-only and G is the motion surface, not another still weight.
Still surfaces are 3:4 at 1080×1440. Reels are 9:16 at 1080×1920.

Start with this failing test shape:

```python
data = load("taxonomy.yaml")
assert [row["id"] for row in data["types"]] == list("ABCDEFG")
assert data["weekly"] == {"reels": 3, "carousels": 3, "singles": 1, "stills": 14, "videos": 3}
assert data["still_weights"] == {"A": 36, "B": 21, "C": 21, "D": 14, "E": 7}
assert data["types"][5]["policy"] == "substitution-only"
```

### Step 2.2: Encode CT-1–CT-7 without inventing new formats

Lift CT-1–CT-7 exactly from r18 §1–§3. Every carousel has at most five slides,
declares its allowed taxonomy types, prevents filler in slot 1, and includes its
caption and hashtag constraints. CT-6 must reveal an outfit, never skin.

Test:

```python
assert ids(load("carousel-templates.yaml")) == [f"CT-{i}" for i in range(1, 8)]
assert all(2 <= len(t["slots"]) <= 5 for t in carousels())
assert all("F" not in t["slots"][0]["allowed_types"] for t in carousels())
assert by_id(carousels(), "CT-6")["name"] == "swipe-reveal"
assert by_id(carousels(), "CT-6")["payoff"] == "outfit-not-skin"
```

### Step 2.3: Encode RT-1–RT-6 and common delivery constraints

Lift RT-1–RT-6 exactly from r18. All share 9:16, 1080×1920, 30 fps, a -14 LUFS
audio target, and `burned_captions: false`. Templates contain bounded inputs and
shot order, not executable upload behavior.

Test:

```python
data = load("reel-templates.yaml")
assert ids(data) == [f"RT-{i}" for i in range(1, 7)]
assert data["delivery"] == {"aspect": "9:16", "width": 1080, "height": 1920,
                            "fps": 30, "audio_lufs": -14, "burned_captions": False}
assert all(t["max_hashtags"] <= data["caption_policy"]["max_hashtags"] for t in data["templates"])
```

Run:

```powershell
py -3 -m pytest orgs/figment/pipeline/content/tests/test_content_data.py -q
```
Expected: taxonomy, CT, RT, surface, count, and hashtag tests pass.

Commit after integration: `feat(figment): add content taxonomy and format templates`.

---

## Task 3: P4e — Role declarations and full creator workflow graph

**Files**

- Create: `agents/figment-{runner,checker,expand,train,render}.md`
- Create: `agents/figment-{content,poster,analyst,researcher}.md`
- Create: `orgs/figment/workflows/figment-creator.md`
- Create: `orgs/figment/workflows/tests/test_figment_creator_workflow.py`

Under P4e's own T2 build card, use the agent-builder factory contract. If it emits
memory/evals outside this list, stage temporarily and copy only declarations. The
existing `grader` reviews P4e; the operator provisions ops memory before arming.

### Step 3.1: Write a failing declaration matrix test

Each declaration has concrete `id`, `role`, `runtime: claude`, `model`,
`default-profile`, `allowed-profiles`, `projects: [figment]`, `runner-bound: true`,
and `description`, plus loop bounds/non-goals. None self-authorizes spend,
publication, account changes, or explicit work.

```python
EXPECTED = {
 "runner": ("manage", "claude-opus-5", "manager:claude:claude-opus-5", ("manager:claude:claude-opus-5", "manager:claude:claude-fable-5")),
 "checker": ("inspect", "claude-opus-5", "worker:claude:claude-opus-5", ("worker:claude:claude-opus-5", "worker:claude:claude-fable-5")),
 "expand": ("work", "claude-sonnet-5", "worker:claude:claude-sonnet-5", ("worker:claude:claude-sonnet-5", "worker:claude:claude-opus-5")),
 "train": ("work", "claude-sonnet-5", "worker:claude:claude-sonnet-5", ("worker:claude:claude-sonnet-5", "worker:claude:claude-opus-5")),
 "render": ("work", "claude-sonnet-5", "worker:claude:claude-sonnet-5", ("worker:claude:claude-sonnet-5", "worker:claude:claude-opus-5")),
 "content": ("work", "claude-sonnet-5", "worker:claude:claude-sonnet-5", ("worker:claude:claude-sonnet-5", "worker:claude:claude-opus-5")),
 "poster": ("work", "claude-opus-5", "worker:claude:claude-opus-5", ("worker:claude:claude-opus-5",)),
 "analyst": ("work", "claude-sonnet-5", "worker:claude:claude-sonnet-5", ("worker:claude:claude-sonnet-5", "worker:claude:claude-opus-5")),
 "researcher": ("work", "claude-sonnet-5", "worker:claude:claude-sonnet-5", ("worker:claude:claude-sonnet-5", "worker:claude:claude-haiku-4-5"))}
for agent_id, expected in EXPECTED.items(): assert_decl(AGENTS / f"figment-{agent_id}.md", expected)
```

Also assert checker is read-only, runner-like roles are runner-bound, allowed
profiles never exceed the default's authority, and every declaration contains a
non-goal against self-approval. Keep bodies concise and link governing files
instead of duplicating the constitution.

### Step 3.2: Encode the S2–S9 workflow as a stage DAG

Use the repository keys `id`, `project`, `title`, `profile`, `governedBy`,
`manager`, `parameters`, and `stages`; stage keys include `id`, `action`, `target`,
`workOrder`, `dependsOn`, `riskTier`, agent/profile fields, gates, and artifacts.

Map generation/training/render/content/posting/analysis/research stages to the
matching declarations. Add a `figment-checker` review stage after every build or
generation boundary. Model every human gate in the spec explicitly. Do not encode
approval as a successful worker exit.

Write tests before the workflow:

```python
workflow = load_workflow(WORKFLOW)
ids = [s["id"] for s in workflow["stages"]]
assert len(ids) == len(set(ids)) and covers_design_phases(ids, "S2", "S9")
assert topological_sort(workflow["stages"]) == ids
assert all(has_review_or_gate(s, workflow) for s in mutating_stages(workflow))
assert all(new_card.validate(materialize_test_card(s, tmp_path)) == [] for s in workflow["stages"])
```

The workflow may describe later phases, but tonight it is declarative only. No
card is dispatched and no account, scheduler, or publisher is activated.

Run the Python workflow-DAG suite plus a pure-Python frontmatter check over the
nine new declarations (offline, no Node/dashboard toolchain, no `npm install`):

```powershell
py -3 -m pytest orgs/figment/workflows/tests/test_figment_creator_workflow.py -q
$check = @'
import re
from pathlib import Path
import yaml

AGENTS = Path("agents")
IDS = ["runner", "checker", "expand", "train", "render", "content", "poster", "analyst", "researcher"]
# The fields every figment-* declaration shares with governance/card-schema.md's own
# card frontmatter vocabulary (role, runtime, model) plus the declaration-only fields
# Step 3.1 requires (id, default-profile, allowed-profiles, projects, runner-bound,
# description).
REQUIRED = ("id", "role", "runtime", "model", "default-profile", "allowed-profiles",
            "projects", "runner-bound", "description")
ROLE_ENUM = {"scout", "manage", "work", "inspect", "consolidate"}
RUNTIME_ENUM = {"claude", "codex"}

for agent_id in IDS:
    path = AGENTS / f"figment-{agent_id}.md"
    text = path.read_text(encoding="utf-8")
    opening = re.match(r"\A---\r?\n", text)
    closing = re.search(r"(?m)^---\r?$", text[opening.end():]) if opening else None
    assert opening and closing, f"{path}: no terminated frontmatter block"
    fm = yaml.safe_load(text[opening.end():opening.end() + closing.start()])
    assert isinstance(fm, dict), f"{path}: frontmatter is not a mapping"
    for field in REQUIRED:
        assert fm.get(field) not in (None, "", []), f"{path}: missing or empty {field!r}"
    assert fm["role"] in ROLE_ENUM, f"{path}: bad role {fm['role']!r}"
    assert fm["runtime"] in RUNTIME_ENUM, f"{path}: bad runtime {fm['runtime']!r}"
print("agent frontmatter ok")
'@
$check | py -3 -
```
A single-quoted PowerShell here-string (`@'...'@`) piped to `py -3 -` on stdin — never
`py -3 -c "..."` with a double-quoted string, which would let PowerShell try to
interpolate the Python source's own `$` end-of-line regex anchors as PowerShell
variables.
Expected: tests pass and stdout ends `agent frontmatter ok`. This replaces any
dashboard-parser (`dashboard/server/workflows/defs.ts`) invocation for tonight's
acceptance bar — that module is ESM TypeScript with a `(source, {knownProfiles})`
signature, not the CommonJS path-taking shape this step used to assume, and its
`node_modules` are not installed in this worktree. A TS-side parse check of
`figment-creator.md` against the real dashboard parser is owed separately and is
not part of tonight's gate.

Commit after integration: `feat(figment): declare creator pipeline roster and workflow`.

---

## Task 4: P4f — Seven bounded, unarmed recurring cadences

**Files**

- Create: `orgs/figment/HEARTBEAT.md`
- Create: `orgs/figment/tests/test_heartbeat.py`

Under P4f's own T2 build card, create only the seven §4 cadence rows. Scheduling
and arming are human-only; every row is `armed: false`, decidable, idempotent, and bounded.

### Step 4.1: Write the cadence inventory test

Encode exactly these rows:

| Cadence | Schedule | Risk | Tier | Agent |
|---|---|---:|---|---|
| figment-cohort-scan | weekly | T3 | desktop | figment-researcher |
| figment-platform-trends | weekly | T1 | cloud | figment-researcher |
| figment-tooling-watch | fortnightly | T1 | cloud | figment-researcher |
| figment-fanvue-economics | monthly | T1 | cloud | figment-researcher |
| figment-insights-pull | daily | T2 | desktop | figment-analyst |
| figment-token-health | daily | T2 | desktop | figment-analyst |
| figment-optimise | weekly | T1 | desktop | figment-analyst |

```python
heartbeat = load_heartbeat(HEARTBEAT)
assert inventory(heartbeat) == EXPECTED_ROWS
assert all(c["armed"] is False for c in heartbeat["cadences"])
```

### Step 4.2: Give each loop a machine-decidable result and hard boundary

Research writes dated evidence/unavailable rows; analysis writes results/no-change;
optimise reads only the warehouse and proposes only. Cohort T3 uses its own tab,
first grid page only, no Story/login/interaction/download. Trends avoids Explore/
Reels; Fanvue forbids spend, payment, message, or engagement. Insights retains raw
response and waits +48h to grade; token health never reads/writes a token. Retry
once, then wake and stop; schedule keys deduplicate rows.

Test the boundaries as data, not prose-only assumptions:

```python
for cadence in (data := load_heartbeat(HEARTBEAT))["cadences"]:
    assert set(cadence) == {"name", "schedule", "tier", "agent", "armed", "risk-tier", "prompt"}
    assert_prompt_is_bounded_idempotent_and_has_noop(cadence["prompt"])
assert_prompt_forbids_social_actions(by_name(data, "figment-cohort-scan")["prompt"])
assert "proposes only" in by_name(data, "figment-optimise")["prompt"]
```

Run:

```powershell
py -3 -m pytest orgs/figment/tests/test_heartbeat.py -q
```
Expected: seven parsed, unarmed, bounded, idempotent cadences with exact assignments.

Commit after integration: `feat(figment): declare bounded research cadences`.

---

## Task 5: P2 — Deterministic expansion-02 builder, manifests, dry run, and resume

**Files**

- Create: `orgs/figment/pipeline/expand/build_expansion_set.py`
- Create: `orgs/figment/pipeline/expand/tests/test_build_expansion_set.py`
- Create: `orgs/figment/pipeline/expand/runs/creator-001-expansion-02-allocation.json`
- Create: `orgs/figment/pipeline/expand/runs/creator-001-expansion-02-shard-01.yaml`
  through `creator-001-expansion-02-shard-06.yaml`
- Create: `orgs/figment/pipeline/expand/runs/creator-001-expansion-02-dry-run.txt`
- Create: `orgs/figment/pipeline/expand/runs/creator-001-expansion-02-captions/`
  containing exactly 60 `.txt` sidecars named by cell ID
- Stage locally, ignored: `orgs/figment/pipeline/expand/runs/_uploads/creator-001/`
  containing g01, g02, and g07 with their original suffixes

Run P2 only after P0R/P1 and under its own T2 build card. Do not modify Task 1
scorer, QA, lifecycle, gate, or persona files in P2. If P2
finds a defect there, stop and return it to P1 rather than folding an unreviewed
scoring change into the manifest commit.

### Step 5.1: Freeze the builder's interfaces and deterministic allocation

Expose:

```python
def generate_allocation(persona) -> list[dict]: ...
def build_prompt(persona, cell) -> str: ...
def build_caption(persona, cell) -> str: ...
def build_manifests(persona_path, base_manifest_path, workflow_path, out_dir) -> list[Path]: ...
def completed_shards(batch) -> set[str]: ...
def missing_shards(allocation, batch) -> list[str]: ...
def harvest_runs(persona_path, allocation_path, run_root, batch_dir) -> dict: ...
```

CLI subcommands are `build` and `harvest`. `build` is byte-reproducible and does
not call the network. `harvest` validates all provenance before copying anything.

Enumerate 40 cells angle-major, then distance, then light. Replicate exactly the 20
half-body strata in that order; close strata are never repeated. Primary wardrobe
rotates by ordinal; each repeat uses the next family modulo five, never its primary
family, plus a new seed. IDs are `exp02-s001`–`s040` and `exp02-r001`–`r020`.
Seed formula is `520001 + ordinal * 1009` for ordinal 1–60.

Write allocation tests first:

```python
one, two = generate_allocation(persona), generate_allocation(persona)
assert one == two and len(one) == 60
assert len({c["cell_id"] for c in one}) == len({c["seed"] for c in one}) == 60
assert len({stratum_key(c) for c in one[:40]}) == 40
assert [c["source_stratum_id"] for c in one[40:]] == [c["stratum_id"] for c in one[:40] if c["distance"] == "half"]
assert all(c["wardrobe_family"] != primary_for(c)["wardrobe_family"] for c in one[40:])
assert all(c["seed"] != primary_for(c)["seed"] for c in one[40:])
assert set(Counter(c["wardrobe_family"] for c in one).values()) == {12}
```

Add a byte-for-byte repeat-build test and assert exactly ten cells per shard.

### Step 5.2: Make prompt and provisional caption generation testable

Every prompt is 80–250 words and includes: an explicit "adult woman" framing per
look-spec-v2 §4b (never a bare pronoun or an unqualified noun for the subject),
requested angle and close/half-body framing, identity-lock clause, one wardrobe
family as a fully opaque intact outfit, environment, requested lighting, mood,
phone-camera medium, and cleanup constraints. It contains no real person's name, no
sexual or unclothed term, and none of look-spec-v2 §4a's banned phrases in any
form — including negation, since §4a's own rationale ("the fix is to describe the
absence rather than to name the aesthetic") is that this text encoder doesn't
reliably negate a named term.

Captions reuse the legacy builder's sidecar/shard pattern but are explicitly
`provisional_generation_caption`; later training must VLM-recaption selected
images. Captions describe visible, clothed facts and never claim a safety verdict.

```python
for cell in generate_allocation(persona):
    prompt = build_prompt(persona, cell)
    assert 80 <= len(prompt.split()) <= 250 and "adult woman" in prompt.lower()
    assert all(x in prompt.lower() for x in ("fully opaque", "intact"))
    assert not any(x.lower() in prompt.lower() for x in BANNED_PHRASES | UNSAFE_TERMS)
assert provisional_captions_match_all_cell_ids(persona)

def test_all_prompt_and_negative_prompt_templates_are_clean_of_banned_terms():
    """Greps every prompt/negative-prompt template this plan produces or inherits —
    the P2 positive-prompt builder above, plus node 5's static negative/cleanup text
    frozen into the manifest builder in Step 5.3 — against look-spec-v2 §4a's full
    banned list (age, soft-glam, bronzer/contour, plastic-skin, lip, brow/lash,
    styling-signature, body, and light families)."""
    templates = [build_prompt(persona, cell) for cell in generate_allocation(persona)]
    templates.append(NODE_5_NEGATIVE_PROMPT)
    for text in templates:
        assert not any(term in text.lower() for term in BANNED_PHRASES)
```

Load `BANNED_PHRASES` from the owning look-spec fixture (look-spec-v2.md §4a) or
mirror it in the test with a comment naming the source section; do not put banned
strings in production prompts. `NODE_5_NEGATIVE_PROMPT` is the exact text Step 5.3
freezes into every manifest's node 5.

### Step 5.3: Build strict manifests from the verified graph

Start from
`orgs/figment/pipeline/train/runs/creator-001-composite-02.yaml`. Copy its `gpu`,
`image`, `price_usd_per_hour`, `models`, `comfyui`, `custom_nodes`, and
`avoid_machine_hosts` fields verbatim — `gpu: {"type": "NVIDIA GeForce RTX 4090",
"count": 1, "cloud": "SECURE"}`, `image:
"runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04"`,
`price_usd_per_hour: 0.80`, `avoid_machine_hosts: ["qvf79yutw3t2"]` — since
`require_manifest()` in `runpod_run.py` hard-requires `gpu`, `image`/`template_id`,
and a numeric positive `price_usd_per_hour`, and the S2 cost math ($0.96/pod,
headroom to the $1.00 cap) only holds at composite-02's $0.80/hr rate. Do not
normalize, reorder, or silently update versions. Only `max_minutes`,
`readiness_timeout_seconds`, `job_timeout_seconds`, `container_disk_gb`, and
`volume_gb` are the fields this task overrides — the 72-minute `max_minutes` (vs.
composite-02's 40) is what satisfies the P0R slack condition; no other field needs
widening for that purpose.

Start from
`orgs/figment/pipeline/train/workflows/klein4b_multiref_api.json`. Retain the three
`LoadImage` nodes, the ReferenceLatent chains, EmptyFlux2LatentImage at 1024×1280,
CFGGuider cfg 4, Flux2Scheduler at 50 steps, and Euler sampler. Rebind LoadImage
nodes 6, 7, and 8 to g01, g02, and g07 in that exact identity-spec order. Node 4
receives the per-job prompt (`build_prompt`, framed as "an adult woman" per §4b).
Node 5 receives only clothed-safe negative/cleanup wording — do not inherit
composite-02.yaml's node 5 text verbatim: it reads "underage appearance, adolescent
features, childlike proportions, ... heavy bronzer, facial contouring, ... studio
glamour photograph", and "childlike", the bronzer/contour family, and the glam
family are look-spec-v2 §4a banned terms, banned even in negation per §4a's own
rationale. Rewrite `NODE_5_NEGATIVE_PROMPT` to keep the safety-exclusion intent in
neutral wording that names no §4a family, e.g.: "nudity, exposed breasts, exposed
genitals, transparent clothing, broken clothing, unnatural body proportions, heavy
visible makeup, plastic-looking skin, studio product photograph." The verified
graph exposes no denoise input: preserve it, record r15b's 0.23 edit band as
provenance, and let P2R block rather than invent an unverified node.

Each emitted manifest has exactly the keys allowed by `pod/README.md`; each job has
only harness-supported job keys. Do not add `identity_set`, captions, stratum data,
or other planning metadata to manifests. That data belongs in allocation JSON and
sidecars. Upload paths are relative to the manifest directory and point into the
ignored `_uploads` sibling.

Set `max_minutes: 72`, `readiness_timeout_seconds: 900`,
`job_timeout_seconds: 300`, `container_disk_gb: 60`, and `volume_gb: 0`.
Test 900 + 10×300 + 300 = 4200 seconds against the 4320-second lease budget.

Omit `network_volume_id`, `network_volume`, `training`, and `artifacts`. Each of the
six manifests has ten jobs and fixed seeds from the allocation.

Write strict validation tests:

```python
paths = build_manifests(PERSONA, BASE, WORKFLOW, tmp_path)
assert names(paths) == [f"creator-001-expansion-02-shard-{i:02d}.yaml" for i in range(1, 7)]
assert all(require_manifest(load_manifest(p), p) is None for p in paths)
assert all(len(load_manifest(p)["jobs"]) == 10 for p in paths)
assert copied_blocks(paths[0], BASE, ("gpu", "image", "price_usd_per_hour", "models", "comfyui", "custom_nodes", "avoid_machine_hosts"))
assert graph_contract(paths[0]) == (["g01", "g02", "g07"], 1024, 1280, 4, 50, "euler")
assert all(no_network_volume_or_unknown_keys(p) for p in paths)
```

### Step 5.4: Prove resume and harvest behavior without a pod

Fixture fake run directories with harness-shaped `run.json`, `manifest.json`, and
ten named outputs. Harvest must verify `termination_verified: true`, shard identity,
expected output names/count, allocation hash, and cost before copying. It copies
provenance into tracked `batches/expansion-02/pod-runs/shard-0N/`, images into the
ignored canonical `images/` directory, and appends one pod-run row to `batch.json`.

Tests:

```python
@pytest.mark.parametrize("finished", [1, 3, 5])
def test_resume_returns_only_missing_shards(finished, batch, allocation):
    batch["pod_runs"] = fake_completed_rows(finished)
    assert missing_shards(allocation, batch) == shard_ids(finished + 1, 6)
def test_harvest_rejects_bad_termination_outputs_hash_or_duplicate(...): ...
def test_identical_reharvest_is_idempotent_and_changed_board_stales_gate(...): ...
```

The idempotent case may return `already-harvested`; it must not add a second cost
row. A conflicting duplicate is always an error.

Run the focused suite:

```powershell
py -3 -m pytest orgs/figment/pipeline/expand/tests/test_build_expansion_set.py -q
```
Expected: allocation, prompts, manifest validation, resume, and harvest tests pass.

### Step 5.5: Materialize the six manifests and prove dry-run behavior

Stage exact anchor bytes into ignored `_uploads/creator-001/`, then run:

```powershell
py -3 orgs/figment/pipeline/expand/build_expansion_set.py build --persona orgs/figment/personas/creator-001/persona.yaml --base-manifest orgs/figment/pipeline/train/runs/creator-001-composite-02.yaml --workflow orgs/figment/pipeline/train/workflows/klein4b_multiref_api.json --out orgs/figment/pipeline/expand/runs
```

Expected: `built 60 cells in 6 shards (10 jobs each)` and the tracked allocation,
six manifests, 60 sidecars, and no extra tracked file.

For N=01 through 06, run this exact command with N substituted:

```powershell
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/expand/runs/creator-001-expansion-02-shard-N.yaml --out orgs/figment/pipeline/expand/runs/out/creator-001-expansion-02-shard-N --max-usd 1.00 --max-minutes 72 --dry-run
```
Capture the six commands, exit codes, manifest hashes, job counts, and summarized
dry-run results in `creator-001-expansion-02-dry-run.txt`. Expected per shard: exit
0, strict manifest accepted, ten jobs planned, zero actual cost, no network call,
and termination verification represented as dry-run-safe rather than a fabricated
live termination.

Finish with:

```powershell
py -3 -m pytest orgs/figment/pipeline/pod/tests orgs/figment/pipeline/expand/tests -q
git diff --check
git status --short
```

Expected: all selected tests pass; only Task 5's tracked files are staged; ignored
uploads and dry-run output directories are absent from status.

Commit after integration: `feat(figment): build expansion-02 manifests and resume state`.

---

## Task 6: P2R — Independent reviewed-SHA live-safety gate

**Files**

- Create: `orgs/figment/pipeline/expand/REVIEW-2026-09-03-expansion-02.md`

Use a fresh model/session that did not author P1/P2. Only the verdict file may be
written. `LIVE-SAFE` enables a T2 spend request; it is not spend approval.

### Step 6.1: Pin the reviewed tree and exact review surface

```powershell
$reviewedSha = (git rev-parse HEAD).Trim()
git status --short
```
Expected: SHA contains P1/P2 and their paths are clean. Record every P1/P2 reviewed
path and SHA-256, including manifests/sidecars. For ignored anchors record hashes,
not a claim about unperformed visual review.

### Step 6.2: Re-run tests and independent invariants

```powershell
py -3 -m pytest orgs/figment/pipeline/pod/tests orgs/figment/pipeline/tests orgs/figment/pipeline/train/tests orgs/figment/pipeline/expand/tests -q
```
Expected: all tests pass.

Independently inspect and record:

- six `require_manifest` passes; 60 unique IDs/seeds; 40 strata + 20 specified
  repeats; ten jobs per shard; resume after 1/3/5; six hashed dry runs;
- g01/g02/g07 chain order; 1024×1280; cfg 4; 50 steps; Euler; verbatim live `gpu`,
  `image`, `price_usd_per_hour`, model, ComfyUI, custom-node, and
  `avoid_machine_hosts` blocks; timeouts 300/900/72;
- no network volume, training/artifact upload, or unknown key;
- 80–250-word adult/clothed positive prompts with no real person or §4a phrase, and
  node 5's negative prompt free of §4a vocabulary in any form, including negation;
- raw-only scoring; no threshold route; seven-axis fail-closed human rubric;
- stale-gate rejection after subject mutation.

Confirm P2 did not modify any P1 scoring, QA, state, gate, or persona code:

```powershell
$p1Commit = (git log -1 --format=%H --grep='^feat(figment): add creator lifecycle and safety schemas$').Trim()
if (-not $p1Commit) { throw 'P1 commit not found' }
git diff --name-only "$p1Commit..$reviewedSha" -- orgs/figment/pipeline/train/identity_check.py orgs/figment/pipeline/qa_stamp.py orgs/figment/pipeline/gates.py orgs/figment/pipeline/expand/batch_state.py orgs/figment/pipeline/persona.py
```
Expected: no output; the exact-message lookup resolved the P1 commit, not P0.

### Step 6.3: Write a fail-closed verdict

Record reviewed SHA/paths/hashes, commands/exits, manifest/dry-run table, safety and
open findings, then exactly `LIVE-SAFE` or `NOT-LIVE-SAFE`. A material unresolved
finding forces the latter.

```powershell
git diff --quiet $reviewedSha -- orgs/figment/pipeline/persona.py orgs/figment/pipeline/gates.py orgs/figment/pipeline/qa_stamp.py orgs/figment/pipeline/train/identity_check.py orgs/figment/pipeline/expand orgs/figment/personas/creator-001/persona.yaml
if ($LASTEXITCODE -ne 0) { throw 'reviewed implementation changed; rerun P2R' }
```

Commit after independent review: `review(figment): gate expansion-02 at reviewed SHA`.

---

## Task 7: P3 — Approved live run, harvest, raw score, blind board, then STOP

**Files**

- Tracked: `orgs/figment/personas/creator-001/batches/expansion-02/batch.json`
- Tracked: `orgs/figment/personas/creator-001/batches/expansion-02/scores.json`
- Tracked: `orgs/figment/personas/creator-001/batches/expansion-02/pod-runs/shard-01/`
  through `shard-06/`, each containing exactly `run.json` and `manifest.json`
- Ignored in the same batch directory: `images/`, `rejected/`, `blind/`,
  `blind-key.json`, and `board.html`
- Ops only: one T2 spend card before launch and one human eye-gate request
- Do not create tonight: `gate.json`, human `rulings.json`, selection, or approval

### Step 7.1: Enforce every preflight gate before creating a spend card

Run `python scripts/preamble.py`; require `PREAMBLE OK`. Resolve the real P0R file
from its done card's `## Result`, not by filename guess; require expansion-02
live-safe at the P0 SHA and never substitute REVIEW-e's old-defect review. Require
P2R `LIVE-SAFE` and repeat its reviewed-path SHA pin.

Record that the current design marks all r15b reports claim-checked and §0/S2/S3/
S5/S6 reconciliation satisfied at `57221caf`; do not reopen that settled gate.
Verify six manifest/allocation hashes, staged anchor hashes, and readable arc/daily
ledgers at `C:\Users\danie\kb-worktrees\figment\ledgers\cost` (the figment
worktree's own ledger directory — see Step 7.3). Any mismatch stops before spend.

### Step 7.2: File the already-human-approved T2 spend card on ops

From the proper ops worktree, pull/rebase `origin ops` immediately before writing.
Create the schema-valid GATE S card before pod 1, containing:

- `owner: figment-expand`, `role: work`, `risk-tier: T2`, `project: figment`;
- `action: figment:expand:expansion-02`; `target:` the six manifest paths
  (`orgs/figment/pipeline/expand/runs/creator-001-expansion-02-shard-01.yaml`
  through `-06.yaml`) plus the batch directory
  `orgs/figment/personas/creator-001/batches/expansion-02/`;
- `runtime: claude`, `model: claude-sonnet-5`, and done P0R/P2R dependencies;
- objective: run expansion-02 shards 01–06 sequentially and stop at eye gate;
- six exact manifest paths and their P2R hashes;
- 10 jobs per pod, six pods maximum;
- `--max-usd 1.00` per pod and 72-minute maximum per pod ($6.00 total ceiling);
- arc cap `$52.85` before each shard (read from
  `C:\Users\danie\kb-worktrees\figment\ledgers\cost`, the figment worktree's own
  ledger directory, not `dashboard-ops`); daily ledger $0.87 + worst-case $6.00 = $6.87;
- no network volume; ephemeral pod only;
- ambient RunPod credential; never record its value;
- stop on ledger disagreement, timeout, bad harvest, or failed termination proof;
- required output: 60 harvested cells, raw scores, blind board, then STOP;
- `approval`: the operator's 2026-09-03 ~07:20 rulings, verbatim: “Launch
  expansion-02 (Recommended)”; “This is a one shot. I will be away, you should be
  running yourself async”; and “You are approved for $10”. Cite them in inert
  Evidence too, never instead of the approval field.

Push immediately and verify the non-null approval and done dependencies. Store only
the card ID/reference in provenance; the boss acts as figment-expand until P4e lands.

### Step 7.3: Run the six live harness commands sequentially

Before each command check the arc ledger. Do not start N+1 until N has a valid
`run.json`, ten images, matching ledger row, and `termination_verified: true`.

Run exactly:

```powershell
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/expand/runs/creator-001-expansion-02-shard-01.yaml --out orgs/figment/pipeline/expand/runs/out/creator-001-expansion-02-shard-01 --max-usd 1.00 --max-minutes 72 --ledger-dir C:/Users/danie/kb-worktrees/figment/ledgers/cost --arc-cap-usd 52.85 --arc-ledger-glob 'figment-*.tsv'
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/expand/runs/creator-001-expansion-02-shard-02.yaml --out orgs/figment/pipeline/expand/runs/out/creator-001-expansion-02-shard-02 --max-usd 1.00 --max-minutes 72 --ledger-dir C:/Users/danie/kb-worktrees/figment/ledgers/cost --arc-cap-usd 52.85 --arc-ledger-glob 'figment-*.tsv'
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/expand/runs/creator-001-expansion-02-shard-03.yaml --out orgs/figment/pipeline/expand/runs/out/creator-001-expansion-02-shard-03 --max-usd 1.00 --max-minutes 72 --ledger-dir C:/Users/danie/kb-worktrees/figment/ledgers/cost --arc-cap-usd 52.85 --arc-ledger-glob 'figment-*.tsv'
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/expand/runs/creator-001-expansion-02-shard-04.yaml --out orgs/figment/pipeline/expand/runs/out/creator-001-expansion-02-shard-04 --max-usd 1.00 --max-minutes 72 --ledger-dir C:/Users/danie/kb-worktrees/figment/ledgers/cost --arc-cap-usd 52.85 --arc-ledger-glob 'figment-*.tsv'
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/expand/runs/creator-001-expansion-02-shard-05.yaml --out orgs/figment/pipeline/expand/runs/out/creator-001-expansion-02-shard-05 --max-usd 1.00 --max-minutes 72 --ledger-dir C:/Users/danie/kb-worktrees/figment/ledgers/cost --arc-cap-usd 52.85 --arc-ledger-glob 'figment-*.tsv'
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/expand/runs/creator-001-expansion-02-shard-06.yaml --out orgs/figment/pipeline/expand/runs/out/creator-001-expansion-02-shard-06 --max-usd 1.00 --max-minutes 72 --ledger-dir C:/Users/danie/kb-worktrees/figment/ledgers/cost --arc-cap-usd 52.85 --arc-ledger-glob 'figment-*.tsv'
```
Expected per shard: exit 0; stdout includes `exit path complete: terminate +
absence verification succeeded`; `run.json` says 10/10 and termination verified;
cost ≤$1.00; ledger run ID/times/cost agree. On mismatch preserve output, emit a
wake-human card, and stop. Never retry live without a human duplicate/spend ruling.

### Step 7.4: Harvest all six shards into one durable batch

Run:

```powershell
py -3 orgs/figment/pipeline/expand/build_expansion_set.py harvest --persona orgs/figment/personas/creator-001/persona.yaml --allocation orgs/figment/pipeline/expand/runs/creator-001-expansion-02-allocation.json --run-root orgs/figment/pipeline/expand/runs/out --batch-dir orgs/figment/personas/creator-001/batches/expansion-02
py -3 orgs/figment/pipeline/expand/batch_state.py mark-stage --batch orgs/figment/personas/creator-001/batches/expansion-02/batch.json --stage generated
```
Expected: `harvested 6/6 shards, 60 cells`. Verify `batch.json` has six unique
pod-run rows, 60 generated cells, the allocation hash, approved card reference,
`stage: "generated"`, and aggregate cost equal to the six ledger rows. Verify 60
image files locally and 12 tracked provenance JSON files. There must be no
`approved` or `curated` cell.

### Step 7.5: Produce raw scores and quarantine only deterministic no-face

Run:

```powershell
py -3 orgs/figment/pipeline/train/identity_check.py --persona orgs/figment/personas/creator-001/persona.yaml --batch orgs/figment/personas/creator-001/batches/expansion-02/batch.json --out orgs/figment/personas/creator-001/batches/expansion-02/scores.json --raw-only
py -3 orgs/figment/pipeline/expand/batch_state.py apply --batch orgs/figment/personas/creator-001/batches/expansion-02/batch.json --scores orgs/figment/personas/creator-001/batches/expansion-02/scores.json
py -3 orgs/figment/pipeline/expand/batch_state.py mark-stage --batch orgs/figment/personas/creator-001/batches/expansion-02/batch.json --stage scored
```
Expected: 60 raw score rows. The apply summary is `scored 60; quarantined
no-face=N; threshold-routed=0`; `batch.json` shows `stage: "scored"`. Move only
deterministic no-face files into the ignored `rejected/` directory.
Null/unavailable metrics stay scored for human inspection. Assert no metric
threshold caused a cull, quarantine, or promotion.

### Step 7.6: Blind the surviving pool and build the eye-gate board

Run:

```powershell
py -3 orgs/figment/pipeline/blind_pool.py build --arm expansion-02=orgs/figment/personas/creator-001/batches/expansion-02/images --pool orgs/figment/personas/creator-001/batches/expansion-02/blind --key orgs/figment/personas/creator-001/batches/expansion-02/blind-key.json --seed 20260903
py -3 orgs/figment/pipeline/build_grading_board.py --manifest orgs/figment/personas/creator-001/batches/expansion-02/blind/manifest.json --out orgs/figment/personas/creator-001/batches/expansion-02/board.html --blind --seed 20260903 --title "creator-001 expansion-02 — GATE A"
```
Expected: blind manifest count equals 60 minus deterministic no-face count; the
board shows anonymous IDs and all seven axes; HTML contains no source paths, arm
labels, cell/stratum labels, or original filenames. The key remains local and
ignored.

### Step 7.7: Persist awaiting-review state and STOP

Write/push an ops eye-gate request that names the approved spend card, P2R reviewed
SHA, batch/allocation/scores/board hashes, image count, no-face count, cost, board
path, and the seven-axis rubric. Ask the human to inspect the board and later
provide explicit rulings/selections.

Do not run `qa_stamp.py`. Do not reveal the blind key. Do not create `gate.json`.
Do not select, curate, approve, train, render, publish, or start expansion-03. A
gate that has not happened is never stamped.

Set the batch-level stage to `awaiting-eye-gate-a` via the Task 1 writer — never by
hand-editing JSON — without changing any scored cell to approved:

```powershell
py -3 orgs/figment/pipeline/expand/batch_state.py mark-stage --batch orgs/figment/personas/creator-001/batches/expansion-02/batch.json --stage awaiting-eye-gate-a
py -3 -m pytest orgs/figment/pipeline/expand/tests orgs/figment/pipeline/tests/test_gates.py -q
git check-ignore -v orgs/figment/personas/creator-001/batches/expansion-02/images/* orgs/figment/personas/creator-001/batches/expansion-02/blind-key.json orgs/figment/personas/creator-001/batches/expansion-02/board.html
git status --short
```

Expected: `batch.json` shows `stage: "awaiting-eye-gate-a"`; tests pass; images,
key, and board are ignored; only `batch.json`, `scores.json`, and the 12 pod-run
provenance files are eligible for this commit. Do not stage unrelated pre-existing
worktree changes.

Commit durable pre-gate metadata only with
`run(figment): harvest expansion-02 for gate A`.

### Step 7.8: Publish today's figment ledger rows to ops

The six shard cost rows were written under `--ledger-dir
C:\Users\danie\kb-worktrees\figment\ledgers\cost` (Step 7.3), inside this worktree —
not the `ops`-checked-out `dashboard-ops` worktree. Per CLAUDE.md, `ledgers/` is a
coordination-write path that belongs on `ops`. Never check `ops` out in this
(the main) checkout; instead cut a temporary branch from `origin/ops`, commit the
rows there, and push with the `<sha>:ops` refspec:

```powershell
git fetch origin ops
$syncBranch = "figment-ledger-sync-$(Get-Date -Format yyyyMMdd-HHmmss)"
git worktree add -b $syncBranch ..\figment-ledger-sync origin/ops
Copy-Item C:\Users\danie\kb-worktrees\figment\ledgers\cost\figment-*.tsv ..\figment-ledger-sync\ledgers\cost\ -Force
git -C ..\figment-ledger-sync add ledgers/cost/figment-*.tsv
git -C ..\figment-ledger-sync commit -m "ledger(figment): expansion-02 shard 01-06 cost rows"
$syncSha = (git -C ..\figment-ledger-sync rev-parse HEAD).Trim()
git push origin "${syncSha}:ops"
git worktree remove ..\figment-ledger-sync
git branch -D $syncBranch
```
Expected: the push succeeds and the `figment-*.tsv` rows land on `ops` without this
worktree ever checking `ops` out. On a rejected push (`ops` moved), `git fetch
origin ops` again, rebase the sync branch onto the new `origin/ops` tip, and retry
— never force-push. Confirm `git branch --show-current` in this (main) worktree is
unchanged before and after.

Report the commit, exact cost, counts, hashes, eye-gate request ID, and the ledger
sync push result to the human, then STOP. A later, separately authorized
continuation may reveal the key, record seven-axis rulings, enforce stratum
coverage, call `write_gate` only after the human decision, and mark the batch
`gate-a-ruled`.

---

### Decisions made where the design was ambiguous

1. P2R follows offline P2 and gates P3, per this work order.
2. Resolve P0R from its done card Result; no review filename is invented.
3. The current spec settles the r15b research gate at `57221caf`; P3 records it satisfied.
4. P4b is dependency-parallel but still T2 under the figment contract.
5. Manifests live in `expand/runs`, harvest metadata in the persona; preserve the verified no-denoise-input graph.
6. Repeats are the 20 half-body strata with next-family wardrobe and a new fixed seed.
7. Stop with awaiting-review state; only a later human decision may create `gate.json`.
