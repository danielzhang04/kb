# proxy-judge (Story-editor-me v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a project-scoped `proxy-judge` skill (Story-editor facet) that stands where Daniel stands after `humanize`, renders his greenlight/revise/reject verdict on a long-form script, and is *proven* to agree with him on a held-out set.

**Architecture:** A facet-agnostic harness skill reads a facet manifest, gathers the taste pack (existing grammar + rubric + gold script + a new calibration set) plus the leash critic's accuracy findings, and dispatches a **fresh-context judge subagent** that writes `videos/<slug>/judge-verdict.md`. Agreement with Daniel's real judgments is measured by two Python helpers (verdict match + same-lines overlap) against a labeled answer key. Only after Story clears the bar is the harness frozen for later `idea`/`art` facets.

**Tech Stack:** Markdown skills/prompts (Claude Code project skills), Python 3 standalone helper scripts (matching the repo's `scripts/*.py` convention — no external deps beyond the stdlib), file-based artifacts, git.

## Global Constraints

*(Copied from the spec + project CLAUDE.md. Every task implicitly includes these.)*

- **Placement is project-scoped — never the global `~/.claude`.** Skill: `faceless-youtube/.claude/skills/proxy-judge/`. Taste packs + calibration: `faceless-youtube/knowledge/proxy-me/<facet>/`.
- **Add-not-merge:** `long-form-writer`'s in-writer critic layer (`critics.md` Step 3d) is left UNCHANGED. proxy-judge is a NEW gate after `humanize`.
- **Imitate content preferences, NOT voice.** Redirects may be phrased however is clearest. Voice-match is never a success criterion.
- **Taste + integration, not fact-tracing.** The judge consumes the existing leash critic's accuracy findings; it does not re-trace `[F-NN]` facts itself.
- **v1 has zero write access to the taste pack.** The judge may *name* an uncodified-rule gap (a stub), never author/modify grammar. (Self-maintaining loop = v2.)
- **The rubric gate is authoritative:** `/36`, publishable = total ≥ 30 AND no 0 on dimensions {1,4,8,11,13,14,16,17,18} (`watchability-rubric.md`).
- **The over-fit-to-Poyais risk is a required test,** not an assumption: the held-out set MUST include ≥1 non-Poyais topic.
- **Dates are absolute `YYYY-MM-DD`.** Log non-trivial decisions to `knowledge/decisions.md`. Python helpers are stdlib-only and runnable as `python <script>.py`.
- **Facet-agnostic harness:** nothing Story-specific may live in `SKILL.md` or the Python helpers — only in the manifest + taste pack.

---

## File Structure

**Create:**
- `.claude/skills/proxy-judge/SKILL.md` — the harness: resolve manifest → gather taste pack + leash findings → dispatch judge subagent → write verdict. Facet-agnostic.
- `.claude/skills/proxy-judge/references/judge.md` — the judge subagent's mandate + the verdict contract.
- `.claude/skills/proxy-judge/references/verdict-schema.md` — the exact shape of `judge-verdict.md`.
- `.claude/skills/proxy-judge/scripts/resolve_manifest.py` — reads the facet manifest, returns resolved file paths for a facet (fails loudly on a missing pack file).
- `.claude/skills/proxy-judge/scripts/score_agreement.py` — compares a set of `judge-verdict.md` files to the answer key; emits verdict-match + same-lines overlap metrics.
- `.claude/skills/proxy-judge/scripts/lint_calibration.py` — validates a `calibration-set.md` against the entry schema.
- `knowledge/proxy-me/facets.md` — the facet manifest (pointer table).
- `knowledge/proxy-me/story/calibration-set.md` — the labeled answer key (clean assets → dig → held-out).
- `knowledge/proxy-me/story/agreement-report.md` — the validation result + the chosen "proven" threshold.
- `knowledge/proxy-me/README.md` — what this folder is; the harness/taste-pack split; how to add a facet.

**Modify:**
- `.claude/skills/README.md` — register `proxy-judge` in the skill list.
- `CLAUDE.md` — add the gate to the Pipeline summary + a context-routing row; bump the status block.
- `knowledge/decisions.md` — append the build decisions.

**Read-only (never modified in v1):**
- `channels/the-second-take/storytelling-grammar.md`, `watchability-rubric.md`, `videos/2026-07-04-poyais/script.md` — the taste pack Story points at.
- `.claude/skills/long-form-writer/references/critics.md` — the leash critic prompt the judge reuses for accuracy findings.

---

## Task 1: Calibration-set schema + validator (`lint_calibration.py`)

Start here because the answer-key format is the contract every later task depends on.

**Files:**
- Create: `.claude/skills/proxy-judge/scripts/lint_calibration.py`
- Create: `.claude/skills/proxy-judge/scripts/testdata/calib_valid.md`
- Create: `.claude/skills/proxy-judge/scripts/testdata/calib_bad.md`
- Test: `.claude/skills/proxy-judge/scripts/test_lint_calibration.py`

**Interfaces:**
- Produces: `parse_calibration(text: str) -> list[dict]` (each entry: `id, source, script_ref, verdict, flagged, notes`), and `lint(text: str) -> list[str]` (list of error strings; empty = valid). CLI: `python lint_calibration.py <file.md>` exits non-zero if errors.

The calibration entry format (authored as fenced YAML blocks inside the markdown, one per entry):

````markdown
```calib
id: CJ-001
source: gold            # gold | before-after | git-history | transcript-dig | held-out
script_ref: channels/the-second-take/videos/2026-07-04-poyais/script.md
verdict: accept         # accept | revise | reject
flagged:                # [] for a clean accept
  - quote: "the mania did the work, not the pitch"
    dimension: 18       # rubric dim # or grammar §; free text ok
    preference: "grandeur button ending a beat"
    fix: "end on the fact/action"
notes: "Gold exemplar; the density + close are the bar."
```
````

- [ ] **Step 1: Write the failing test**

```python
# test_lint_calibration.py
import subprocess, sys, pathlib
HERE = pathlib.Path(__file__).parent
from lint_calibration import parse_calibration, lint

def test_parses_valid_entries():
    text = (HERE / "testdata" / "calib_valid.md").read_text(encoding="utf-8")
    entries = parse_calibration(text)
    assert len(entries) == 2
    assert entries[0]["id"] == "CJ-001"
    assert entries[0]["verdict"] == "accept"
    assert entries[0]["flagged"] == []            # clean accept
    assert entries[1]["flagged"][0]["quote"]      # reject carries a flag

def test_lint_flags_bad_entry():
    text = (HERE / "testdata" / "calib_bad.md").read_text(encoding="utf-8")
    errs = lint(text)
    assert any("verdict" in e for e in errs)      # bad verdict value
    assert any("reject" in e and "flagged" in e for e in errs)  # reject with no flags
```

- [ ] **Step 2: Create the fixtures**

`testdata/calib_valid.md` — two `calib` blocks: `CJ-001` an `accept` with `flagged: []`; `CJ-002` a `reject` with one `flagged` entry (quote/dimension/preference/fix) as shown above.

`testdata/calib_bad.md` — one block with `verdict: perfect` (invalid) and one `verdict: reject` whose `flagged:` is empty.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd .claude/skills/proxy-judge/scripts && python -m pytest test_lint_calibration.py -v`
Expected: FAIL with `ModuleNotFoundError: lint_calibration` (or `ImportError`).
*(If pytest is unavailable in the env, add `if __name__ == "__main__":` asserts and run `python test_lint_calibration.py`; expected: traceback on the missing module.)*

- [ ] **Step 4: Implement `lint_calibration.py`**

```python
#!/usr/bin/env python3
"""Validate a proxy-me calibration-set.md against the entry schema."""
import sys, re, pathlib

VERDICTS = {"accept", "revise", "reject"}
SOURCES = {"gold", "before-after", "git-history", "transcript-dig", "held-out"}
BLOCK = re.compile(r"```calib\n(.*?)```", re.S)

def _yaml_lite(block: str) -> dict:
    # Minimal indent-aware parser for our fixed shape (no external deps).
    out, cur_list, cur_item = {}, None, None
    for raw in block.splitlines():
        if not raw.strip():
            continue
        indent = len(raw) - len(raw.lstrip())
        line = raw.strip()
        if indent == 0 and line.endswith(":") and ":" == line[-1]:
            cur_list, out[line[:-1]] = [], []
            out[line[:-1]] = cur_list = []
        elif indent == 0 and ":" in line:
            k, v = line.split(":", 1)
            out[k.strip()] = v.strip().strip('"')
            cur_list = None
        elif line.startswith("- "):
            cur_item = {}
            k, v = line[2:].split(":", 1)
            cur_item[k.strip()] = v.strip().strip('"')
            if cur_list is not None:
                cur_list.append(cur_item)
        elif ":" in line and cur_item is not None:
            k, v = line.split(":", 1)
            cur_item[k.strip()] = v.strip().strip('"')
    return out

def parse_calibration(text: str) -> list:
    entries = []
    for m in BLOCK.finditer(text):
        e = _yaml_lite(m.group(1))
        e.setdefault("flagged", [])
        if isinstance(e["flagged"], str):
            e["flagged"] = []
        entries.append(e)
    return entries

def lint(text: str) -> list:
    errs = []
    for e in parse_calibration(text):
        eid = e.get("id", "<no-id>")
        if e.get("verdict") not in VERDICTS:
            errs.append(f"{eid}: bad verdict {e.get('verdict')!r}")
        if e.get("source") not in SOURCES:
            errs.append(f"{eid}: bad source {e.get('source')!r}")
        if e.get("verdict") in {"revise", "reject"} and not e.get("flagged"):
            errs.append(f"{eid}: verdict {e.get('verdict')} but flagged is empty")
        if not e.get("script_ref"):
            errs.append(f"{eid}: missing script_ref")
    return errs

if __name__ == "__main__":
    text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
    errs = lint(text)
    for e in errs:
        print("ERROR:", e)
    sys.exit(1 if errs else 0)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd .claude/skills/proxy-judge/scripts && python -m pytest test_lint_calibration.py -v`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/proxy-judge/scripts/lint_calibration.py \
        .claude/skills/proxy-judge/scripts/test_lint_calibration.py \
        .claude/skills/proxy-judge/scripts/testdata/
git commit -m "feat(proxy-judge): calibration-set schema + validator"
```

---

## Task 2: Facet manifest + resolver (`resolve_manifest.py`)

**Files:**
- Create: `knowledge/proxy-me/facets.md`
- Create: `knowledge/proxy-me/README.md`
- Create: `.claude/skills/proxy-judge/scripts/resolve_manifest.py`
- Test: `.claude/skills/proxy-judge/scripts/test_resolve_manifest.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolve(facet: str, channel: str, repo_root: pathlib.Path) -> dict` returning `{grammar, rubric, gold, calibration, gates}` as absolute paths (gates as a string), raising `FileNotFoundError` listing every missing file. CLI: `python resolve_manifest.py <facet> <channel>` prints the resolved paths or the missing-file errors.

`knowledge/proxy-me/facets.md` content (the pointer table; `<ch>` is substituted from the channel arg):

```
## story
grammar:     channels/<ch>/storytelling-grammar.md
rubric:      channels/<ch>/watchability-rubric.md
gold:        channels/<ch>/videos/2026-07-04-poyais/script.md
calibration: knowledge/proxy-me/story/calibration-set.md
gates:       total>=30; no-zero on 1,4,8,11,13,14,16,17,18
```

- [ ] **Step 1: Write the failing test**

```python
# test_resolve_manifest.py
import pathlib, pytest
from resolve_manifest import resolve
ROOT = pathlib.Path(__file__).resolve().parents[4]  # repo root

def test_resolves_story_paths():
    r = resolve("story", "the-second-take", ROOT)
    assert r["grammar"].name == "storytelling-grammar.md"
    assert r["grammar"].exists()
    assert "no-zero" in r["gates"]

def test_missing_facet_raises():
    with pytest.raises(KeyError):
        resolve("does-not-exist", "the-second-take", ROOT)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .claude/skills/proxy-judge/scripts && python -m pytest test_resolve_manifest.py -v`
Expected: FAIL (`ModuleNotFoundError: resolve_manifest`).

- [ ] **Step 3: Implement `resolve_manifest.py`**

```python
#!/usr/bin/env python3
"""Resolve a proxy-me facet manifest to absolute, existence-checked paths."""
import sys, re, pathlib

def _load_facets(repo_root: pathlib.Path) -> dict:
    text = (repo_root / "knowledge/proxy-me/facets.md").read_text(encoding="utf-8")
    facets, cur = {}, None
    for line in text.splitlines():
        if line.startswith("## "):
            cur = line[3:].strip(); facets[cur] = {}
        elif cur and ":" in line and not line.startswith("#"):
            k, v = line.split(":", 1); facets[cur][k.strip()] = v.strip()
    return facets

def resolve(facet: str, channel: str, repo_root: pathlib.Path) -> dict:
    facets = _load_facets(repo_root)
    if facet not in facets:
        raise KeyError(f"unknown facet {facet!r}; have {sorted(facets)}")
    spec, out, missing = facets[facet], {}, []
    for key, val in spec.items():
        if key == "gates":
            out["gates"] = val; continue
        p = repo_root / val.replace("<ch>", channel)
        out[key] = p
        if not p.exists():
            missing.append(str(p))
    if missing:
        raise FileNotFoundError("missing taste-pack files:\n  " + "\n  ".join(missing))
    return out

if __name__ == "__main__":
    root = pathlib.Path(__file__).resolve().parents[4]
    r = resolve(sys.argv[1], sys.argv[2], root)
    for k, v in r.items():
        print(f"{k}: {v}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd .claude/skills/proxy-judge/scripts && python -m pytest test_resolve_manifest.py -v`
Expected: 2 passed. (If `calibration-set.md` does not exist yet, temporarily create an empty one; Task 4 fills it. Note this in the commit.)

- [ ] **Step 5: Write `knowledge/proxy-me/README.md`**

Explain: the harness (skill + scripts) is facet-agnostic; taste packs are per-facet data pointed at by `facets.md`; to add a facet, author its taste pack + calibration set and add a `##` block. Reference the design spec `docs/superpowers/specs/2026-07-09-proxy-judge-story-editor-me-design.md`.

- [ ] **Step 6: Commit**

```bash
git add knowledge/proxy-me/facets.md knowledge/proxy-me/README.md \
        .claude/skills/proxy-judge/scripts/resolve_manifest.py \
        .claude/skills/proxy-judge/scripts/test_resolve_manifest.py
git commit -m "feat(proxy-judge): facet manifest + resolver"
```

---

## Task 3: Verdict schema + agreement scorer (`score_agreement.py`)

Build the measurement BEFORE the judge, so "proven" has a definition the judge is written against.

**Files:**
- Create: `.claude/skills/proxy-judge/references/verdict-schema.md`
- Create: `.claude/skills/proxy-judge/scripts/score_agreement.py`
- Create: `.claude/skills/proxy-judge/scripts/testdata/verdict_sample.md`
- Test: `.claude/skills/proxy-judge/scripts/test_score_agreement.py`

**Interfaces:**
- Consumes: `parse_calibration` from Task 1 (answer key), a parsed `judge-verdict.md`.
- Produces: `parse_verdict(text: str) -> dict` (`{verdict, score, flagged:[{quote,...}]}`), and `score(pred: dict, truth: dict) -> dict` returning `{verdict_match: bool, line_precision: float, line_recall: float}`. Same-lines overlap matches on a normalized quote (lowercased, whitespace-collapsed, first 8 words). CLI: `python score_agreement.py <verdicts_dir> <calibration.md>` prints per-item + aggregate.

`verdict-schema.md` defines the `judge-verdict.md` shape with a fenced `verdict` block mirroring the calibration `flagged` shape, plus `verdict:`, `score:` (e.g. `31/36`), `confidence:`, `calibration_anchor:`, and a free-text `proposed_rule_stub:`.

- [ ] **Step 1: Write the failing test**

```python
# test_score_agreement.py
from score_agreement import parse_verdict, score, norm_quote

def test_norm_quote_matches_paraphrase_prefix():
    a = norm_quote("The mania did the work, not the pitch.")
    b = norm_quote("the mania  did the WORK, not the pitch")
    assert a == b

def test_verdict_match_and_line_overlap():
    truth = {"verdict": "reject",
             "flagged": [{"quote": "the mania did the work not the pitch"},
                         {"quote": "a country that did not exist"}]}
    pred = {"verdict": "reject",
            "flagged": [{"quote": "The mania did the work, not the pitch!"}]}
    r = score(pred, truth)
    assert r["verdict_match"] is True
    assert r["line_recall"] == 0.5     # caught 1 of 2
    assert r["line_precision"] == 1.0  # its 1 flag was real
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .claude/skills/proxy-judge/scripts && python -m pytest test_score_agreement.py -v`
Expected: FAIL (`ModuleNotFoundError: score_agreement`).

- [ ] **Step 3: Implement `score_agreement.py`**

```python
#!/usr/bin/env python3
"""Score proxy-judge verdicts against Daniel's calibration answer key."""
import sys, re, pathlib
from lint_calibration import parse_calibration

def norm_quote(q: str) -> str:
    q = re.sub(r"[^\w\s]", "", q.lower())
    return " ".join(q.split()[:8])

def parse_verdict(text: str) -> dict:
    m = re.search(r"```verdict\n(.*?)```", text, re.S)
    body = m.group(1) if m else text
    verdict = (re.search(r"verdict:\s*(\w+)", body) or [None, None])[1]
    quotes = re.findall(r'quote:\s*"?(.+?)"?\s*$', body, re.M)
    return {"verdict": verdict, "flagged": [{"quote": q} for q in quotes]}

def score(pred: dict, truth: dict) -> dict:
    pset = {norm_quote(f["quote"]) for f in pred.get("flagged", [])}
    tset = {norm_quote(f["quote"]) for f in truth.get("flagged", [])}
    hits = len(pset & tset)
    return {
        "verdict_match": pred.get("verdict") == truth.get("verdict"),
        "line_recall": (hits / len(tset)) if tset else 1.0,
        "line_precision": (hits / len(pset)) if pset else 1.0,
    }

if __name__ == "__main__":
    vdir, calib = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    truth = {e["id"]: e for e in parse_calibration(calib.read_text(encoding="utf-8"))}
    agg = {"verdict_match": 0, "n": 0}
    for vf in sorted(vdir.glob("*.md")):
        cid = vf.stem
        if cid not in truth:
            continue
        r = score(parse_verdict(vf.read_text(encoding="utf-8")), truth[cid])
        agg["verdict_match"] += int(r["verdict_match"]); agg["n"] += 1
        print(cid, r)
    if agg["n"]:
        print(f"AGGREGATE verdict-agreement: {agg['verdict_match']}/{agg['n']}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd .claude/skills/proxy-judge/scripts && python -m pytest test_score_agreement.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/proxy-judge/references/verdict-schema.md \
        .claude/skills/proxy-judge/scripts/score_agreement.py \
        .claude/skills/proxy-judge/scripts/test_score_agreement.py \
        .claude/skills/proxy-judge/scripts/testdata/verdict_sample.md
git commit -m "feat(proxy-judge): verdict schema + agreement scorer"
```

---

## Task 4: Assemble the calibration answer key (clean assets + bounded dig)

This is a **data + subagent** task, not code. Deliverable: a populated, lint-passing `calibration-set.md`. Right-sized as one task because it produces one artifact validated by one gate (`lint_calibration.py`).

**Files:**
- Create/fill: `knowledge/proxy-me/story/calibration-set.md`

**Interfaces:**
- Consumes: `lint_calibration.py` (Task 1) as the acceptance gate.
- Produces: the labeled answer key every later task reads.

- [ ] **Step 1: Seed from clean assets (no subagent needed)**
  - `CJ-001` = gold Poyais `script.md` → `source: gold`, `verdict: accept`, `flagged: []`, notes = why it's the bar.
  - One `before-after` entry per row of `storytelling-grammar.md` §5 → `source: before-after`, `verdict: reject`, one `flagged` item each (quote = the "before" tell, preference = the tell name, fix = the "after").

- [ ] **Step 2: Mine the git history of `script.md` (no subagent needed)**

Run: `git -C <repo> log --follow -p -- channels/the-second-take/videos/2026-07-04-poyais/script.md`
For each revision that removed a taste defect, add a `git-history` entry: the removed line as `quote`, the change as `fix`, `verdict: revise`.

- [ ] **Step 3: Dispatch a subagent for the bounded transcript dig**

Prompt (general-purpose subagent): "Search the JSONL session transcripts under `C:/Users/danie/.claude/projects/C--Users-danie-faceless-youtube/` for the SCRIPT-GATE moments only — where Daniel reacted to a long-form draft (accepted, sent back, or said what to change). Ignore everything else (visuals, voice, infra). For each reaction extract: the substantive judgment (what he wanted changed and why), NOT his phrasing. Return 15-40 items as `calib` YAML blocks, `source: transcript-dig`, verdict inferred (accept/revise/reject), each `flagged` item carrying the substantive preference. Deduplicate against `storytelling-grammar.md` §5 — only include judgments NOT already codified there. Return the blocks as text; write nothing."

Append the returned blocks to `calibration-set.md` under a "## Transcript dig" heading.

- [ ] **Step 4: Split held-out vs. training**

Mark 5-8 entries `source: held-out` and move them to a separate `## HELD-OUT (do not train on)` section — these are for Task 7. Ensure ≥1 is a non-Poyais topic (if none exists in the dig, this slot is filled by a fresh draft in Task 7). The judge in Task 5/6 must NOT be shown the held-out section.

- [ ] **Step 5: Validate**

Run: `cd .claude/skills/proxy-judge/scripts && python lint_calibration.py ../../../../knowledge/proxy-me/story/calibration-set.md`
Expected: exit 0, no `ERROR:` lines. Fix any flagged entries.

- [ ] **Step 6: Commit**

```bash
git add knowledge/proxy-me/story/calibration-set.md
git commit -m "data(proxy-judge): story calibration answer key (clean + dig, held-out split)"
```

---

## Task 5: Write the judge subagent prompt (`judge.md`)

Authoring task. Deliverable: the prompt the harness dispatches. Acceptance = a manual dry-run produces a verdict that parses under `verdict-schema.md`.

**Files:**
- Create: `.claude/skills/proxy-judge/references/judge.md`

**Interfaces:**
- Consumes: the resolved taste pack (Task 2), the leash critic prompt (`long-form-writer/references/critics.md`), the verdict schema (Task 3).
- Produces: a `judge-verdict.md` conforming to the schema.

- [ ] **Step 1: Write the mandate.** The judge is a fresh-context reader with no attachment to the draft, standing where Daniel stands *after* humanize. It renders the acceptance verdict — it is NOT the subtractive in-writer critic. Read order: `storytelling-grammar.md` §0 gold first, then the rubric, then the **training** section of `calibration-set.md` (never the held-out section), then the draft.

- [ ] **Step 2: Write the scoring + integration procedure.** (a) Score all 18 rubric dimensions 0/1/2 with the gate. (b) Apply the calibration preferences (the uncodified judgments from the dig) on top of the rubric. (c) Consume the leash critic's accuracy findings for this draft (see Task 6 for how they're supplied) and fold them into the verdict — do NOT re-trace facts. (d) Map to `greenlight` (gate clear + no reject-level calibration hit) / `revise` (fixable) / `reject` (gate fail or fundamental).

- [ ] **Step 3: Write the output contract** — emit exactly the `verdict-schema.md` shape: `verdict`, `score` (`NN/36`), ranked `flagged` (quote · dimension/preference · why · substantive fix, phrased freely), `confidence`, `calibration_anchor` (which training entry this draft most resembles), `proposed_rule_stub` (name an uncodified gap; do NOT author a rule). Reiterate: **content preference, not voice; zero taste-pack writes.**

- [ ] **Step 4: Dry-run acceptance check.** Manually dispatch the judge on the gold Poyais `script.md`. Expected: `verdict: greenlight`, `score` ≥ 30, `flagged` near-empty. Then run `python score_agreement.py` on that single verdict vs. `CJ-001` — expect `verdict_match: True`. If it rejects the gold, the prompt is miscalibrated; fix before committing.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/proxy-judge/references/judge.md
git commit -m "feat(proxy-judge): judge subagent mandate + verdict contract"
```

---

## Task 6: Write the harness `SKILL.md` + wire the gate

**Files:**
- Create: `.claude/skills/proxy-judge/SKILL.md`
- Modify: `.claude/skills/README.md` (register the skill)

**Interfaces:**
- Consumes: `resolve_manifest.py`, `judge.md`, `critics.md` (leash critic), the verdict schema.
- Produces: `videos/<slug>/judge-verdict.md`; a `greenlight|revise|reject` signal for the pipeline.

- [ ] **Step 1: Write the SKILL.md frontmatter** (facet-agnostic description; triggers on "judge the script / would-Daniel-approve / run the acceptance gate / proxy-me review"). Args: `<slug>`, `--facet story` (default), `--channel the-second-take`, `--mode advisory|blocking`.

- [ ] **Step 2: Write the harness procedure:** (1) `python scripts/resolve_manifest.py <facet> <channel>` → taste-pack paths. (2) Run the leash critic (`long-form-writer/references/critics.md` leash prompt) on the draft → store findings at `videos/<slug>/leash-findings.md`. (3) Dispatch the judge subagent (`references/judge.md`) with the taste pack (training only) + the leash findings. (4) Write `judge-verdict.md`. (5) In `advisory` mode: print the verdict, continue. In `blocking` mode: `greenlight` → proceed; `revise` → return redirects to `long-form-writer`; `reject` → stop + surface to human.

- [ ] **Step 3: State the guardrails in-skill** — never read the held-out calibration section; zero taste-pack writes; accuracy is the leash critic's, not the judge's; leave `critics.md` Step 3d untouched.

- [ ] **Step 4: Register in `.claude/skills/README.md`** — add the `proxy-judge` row (name, one-line purpose, runs-after `humanize`, project-scoped).

- [ ] **Step 5: End-to-end dry-run** on the gold Poyais draft via the skill entry point (advisory mode). Expected: writes a schema-valid `judge-verdict.md` with `greenlight`. Confirm `resolve_manifest.py` and the leash step ran (findings file exists).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/proxy-judge/SKILL.md .claude/skills/README.md
git commit -m "feat(proxy-judge): harness skill + gate wiring (advisory/blocking)"
```

---

## Task 7: Prove it — held-out blind-rating + threshold

Human-in-loop validation. Deliverable: `agreement-report.md` with the measured agreement and the chosen "proven" threshold. **This is the make-or-break gate; the harness is not frozen until it passes.**

**Files:**
- Create: `knowledge/proxy-me/story/agreement-report.md`
- Modify: `knowledge/decisions.md`

**Interfaces:**
- Consumes: the held-out set (Task 4 Step 4), the skill (Task 6), `score_agreement.py` (Task 3).

- [ ] **Step 1: Prepare the held-out drafts.** Gather the 5-8 held-out scripts, **≥1 non-Poyais topic**. If a non-Poyais draft doesn't exist, generate one via `long-form-writer` on a fresh idea first (it need not be published — it's a test fixture).

- [ ] **Step 2: Daniel rates blind.** For each held-out draft Daniel records his own `accept/revise/reject` + the lines he'd change — WITHOUT seeing the judge's output. Capture as `held-out` calibration entries (the ground truth).

- [ ] **Step 3: Run the judge blind.** Run `proxy-judge --mode advisory` on each held-out draft → one `judge-verdict.md` per draft, named to match its calibration `id`, in a `videos/_holdout-verdicts/` dir. The judge must not have the held-out entries in its taste pack.

- [ ] **Step 4: Measure.** Run: `python scripts/score_agreement.py <holdout-verdicts-dir> ../../../knowledge/proxy-me/story/calibration-set.md`. Record per-draft verdict-match + line precision/recall and the aggregate.

- [ ] **Step 5: Set the threshold + verdict.** Write `agreement-report.md`: the numbers, the chosen "proven" bar (proposal: verdict-match ≥ 80% AND mean line-recall ≥ 0.5, with special attention to the non-Poyais draft), and PASS/FAIL. Log the decision in `knowledge/decisions.md`.

- [ ] **Step 6: Commit**

```bash
git add knowledge/proxy-me/story/agreement-report.md knowledge/decisions.md \
        knowledge/proxy-me/story/calibration-set.md
git commit -m "test(proxy-judge): held-out blind-rating + proven threshold"
```

---

## Task 8: Tune-or-freeze + integrate the router

**Files:**
- Modify: `CLAUDE.md` (Pipeline summary, context-routing table, status block)
- Modify: `.claude/skills/proxy-judge/references/judge.md` (only if tuning)
- Modify: `knowledge/decisions.md`

- [ ] **Step 1: Branch on the Task 7 verdict.**
  - **FAIL:** diagnose each disagreement (is it a missing calibration preference, a rubric gap, or over-fit to Poyais?). Add the missing judgments to the *training* section only, adjust `judge.md`, re-run Task 7 Steps 3-5. One tuning cycle per commit; do NOT loop silently — surface persistent disagreement to Daniel.
  - **PASS:** proceed to freeze.

- [ ] **Step 2: Freeze the harness.** Note in `knowledge/proxy-me/README.md` that the harness (skill + scripts + verdict contract + calibration protocol) is frozen as of the passing date, and that `idea`/`art` facets reuse it by adding a taste pack + calibration set only.

- [ ] **Step 3: Integrate the router (CLAUDE.md).** Add proxy-judge to the Pipeline summary (`… → humanize → proxy-judge gate → voiceover ∥ visuals …`); add a context-routing row ("Judging / acceptance-gating a finished script" → `proxy-judge` + its taste pack); update the status block with the new skill (now 10) and the proxy-me capability. Bump `index.html` "Last updated" per operating rule 4.

- [ ] **Step 4: Log the decision** in `knowledge/decisions.md` (build + the proven result + the frozen-harness milestone + the idea/art next-steps).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md index.html knowledge/decisions.md \
        knowledge/proxy-me/README.md .claude/skills/proxy-judge/references/judge.md
git commit -m "feat(proxy-judge): integrate gate into router; freeze harness after proven bar"
```

---

## Self-Review (against the spec)

**Spec coverage:**
- §1 reframe / out-of-scope → enforced in Global Constraints + Task 5/6 guardrails (voice-not-imitated, no fact-tracing, no taste writes, add-not-merge). ✓
- §2 architecture (harness + taste pack, attach after humanize, project placement) → Tasks 2, 6. ✓
- §3 verdict contract → Task 3 (schema) + Task 5 (judge emits it). ✓
- §4 calibration (clean assets + bounded dig + held-out incl. non-Poyais; the proven bar) → Tasks 1, 4, 7. ✓
- §4.3 over-fit risk → Task 4 Step 4, Task 7 Step 1/5 (non-Poyais required). ✓
- §5 generalization (facet manifest, freeze-then-replicate) → Task 2 + Task 8 Step 2. ✓
- §6 components → Tasks 1-6 one-to-one. ✓
- §7 open items (threshold, gate-location, leash-consumption mechanism, calib schema) → threshold Task 7.5; gate-location Task 6.2; leash mechanism Task 6.2 (stored findings file); calib schema Task 1. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"; all code steps carry full code; test steps carry real assertions. The one deferred value (numeric threshold) is a deliberate Task-7 output, not a plan gap. ✓

**Type consistency:** `parse_calibration` (Task 1) reused verbatim in Task 3's scorer; `norm_quote`/`score`/`parse_verdict` names match between test and impl; `resolve()` return keys (`grammar/rubric/gold/calibration/gates`) match the manifest keys and the SKILL.md consumption. ✓

**Note on repo test convention:** tests assume `pytest`. If the project has no pytest, each `test_*.py` also runs under `python test_*.py` with the same asserts (add a `__main__` guard calling the test fns). Confirm the convention in Task 1 and keep it consistent.
