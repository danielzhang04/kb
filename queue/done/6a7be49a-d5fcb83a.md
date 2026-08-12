---
id: 6a7be49a-d5fcb83a
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-codex-image-engine
risk-tier: T1
owner: codex-worker
claim-token: 0ec9a46fce2f3353
state: done
approval: null
workflow: 019ff3f1-1787-7dd1-9c45-73d1080f65e6
depends-on: []
variant-group: null
role: work
session-id: 6a7be399-0e18924e
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Task C2 review — idiom translation table (fresh-context SDD task review)

Review Task C2, the HEAD commit on `claude/codex-image-engine` in the arc worktree (your cwd);
fix scope = HEAD~1..HEAD. Workspace-write for pytest; MODIFY NOTHING, no commits, never
invoke real codex.

Context: plan Task C2 = lines 1289–1450 (excerpt below); design authority =
`scratch-codex-image-engine/p2b-prompting-research.md` COMPOSER BRIEF section;
`.superpowers/sdd/2026-08-11-codex-image-engine/task-C2-report.md`.

Verify:
1. Suite: 20 passed.
2. Translation-table fidelity: every idiom mapping the plan section specifies exists with the
   plan's exact target phrasing; every mapping is consistent with the P2b research (the
   research OVERRULES stale plan text — flag unflagged conflicts).
3. Residual scan: does the scan actually catch untranslated Gemini idioms in a composed
   prompt (test it with a poisoned input), or only exact-string matches the table already
   handles? Weak-scan = finding.
4. Tests: would a silently dropped table row or a broken residual scan fail a test?
5. Hygiene: HEAD touches exactly the two named files; AST import pin unchanged OR updated
   only with plan authorization (check the report's claim); forge.py byte-identical; entropy
   scan zero-hit.

Output: line 1 `VERDICT: APPROVED` or `VERDICT: NEEDS-FIXES`; per-item PASS/FAIL; findings
with file:line (none → `Findings: none`).

=== PLAN TASK C2 (verbatim) ===
\## Task C2 — idiom translation table + residual scan

Spec §4.3, test case 7. P1 probe E2 rendered a literal `TOTE RACK / STAGE-LEFT` sign from this
pipeline's staging idiom; the table changes wording only and never deletes a staging fact.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: nothing new.
- Produces: `IDIOM_TABLE: list[tuple[re.Pattern, str]]`, `translate_idiom(text: str) -> str`,
  `residual_idiom(text: str) -> list[str]`.

**Steps**

- [ ] Add the failing tests (real L46 / L47 payload text from `<VIDEO>/shots.json`):

```python
L46_PAYLOAD = ("One seeded performer, `base`, `expr-crestfallen`, `hold-both-hands`, in a grey work "
               "coat, stage-left, carrying a cardboard box of desk things down the length of the "
               "assembly floor toward the roller door. On the far side of the far bench a subdued "
               "crowd stands and watches him go, arms down, faces flat and tired. Cool grey-teal "
               "palette drained toward grey, flat strip light with every fourth ceiling fitting "
               "dark, foreground depth from a cropped bench end at the lower-right.")

L47_PAYLOAD = ("`terry-johnson`, `expr-crestfallen`, `carry-by-handle`, stage-right, stepping out "
               "through a glass door onto a car park apron with a document case at his side, his "
               "back half turned to the floor behind him. Through the glass the assembly floor runs "
               "away into the depth with its benches bare. Grey-cream-teal palette, flat overcast "
               "light outside against warm strip light inside, foreground depth from a cropped kerb "
               "at the lower-left.")


def test_idiom_table_translates_every_documented_direction():
    import forge_codex as fc
    assert fc.translate_idiom("stage-left,") == "on the left of the frame,"
    assert fc.translate_idiom("Stage Right") == "on the right of the frame"
    assert fc.translate_idiom("stage-centre") == "centred in the frame"
    assert fc.translate_idiom("stage center") == "centred in the frame"
    assert fc.translate_idiom("upstage") == "toward the back of the frame"
    assert fc.translate_idiom("up stage") == "toward the back of the frame"
    assert fc.translate_idiom("downstage") == "toward the front of the frame"
    assert fc.translate_idiom("camera-left") == "on the left of the frame"
    assert fc.translate_idiom("camera right") == "on the right of the frame"
    assert fc.translate_idiom("off-stage") == "outside the frame"
    assert fc.translate_idiom("offstage") == "outside the frame"


def test_idiom_translation_on_real_shot_payloads_keeps_every_fact():
    import forge_codex as fc
    out46 = fc.translate_idiom(L46_PAYLOAD)
    assert "stage-left" not in out46 and "on the left of the frame" in out46
    for noun in ("grey work coat", "cardboard box", "roller door", "subdued", "bench"):
        assert noun in out46, noun
    assert len(out46.split()) >= len(L46_PAYLOAD.split())
    out47 = fc.translate_idiom(L47_PAYLOAD)
    assert "stage-right" not in out47 and "on the right of the frame" in out47
    for noun in ("glass door", "car park apron", "document case", "kerb"):
        assert noun in out47, noun


def test_idiom_translation_never_touches_quoted_literals():
    import forge_codex as fc
    src = "a painted board reading 'STAGE-LEFT' hanging stage-left over him"
    out = fc.translate_idiom(src)
    assert "'STAGE-LEFT'" in out
    assert "hanging on the left of the frame over him" in out
    src2 = 'the sign "UPSTAGE DOCK" seen from upstage'
    out2 = fc.translate_idiom(src2)
    assert '"UPSTAGE DOCK"' in out2 and "from toward the back of the frame" in out2


def test_residual_scan_warns_without_raising():
    import forge_codex as fc
    assert fc.residual_idiom(L47_PAYLOAD) == []
    hits = fc.residual_idiom("he waits in the wings, left of the blocking mark")
    assert hits and any("wings" in h for h in hits)
    assert isinstance(hits, list)
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'translate_idiom'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py` (after the exceptions block):

```python
import re  # noqa: E402

\# --- §4.3 idiom translation: this pipeline's STAGING idiom renders as literal signage on codex
\# --- (p1 probe E2 minted a "TOTE RACK / STAGE-LEFT" sign). Ordered, word-boundary, case-insensitive.
\# --- It changes WORDING only: dropping a load-bearing staging fact would be the fidelity violation
\# --- named at SKILL.md L395-397.
IDIOM_TABLE = [
    (re.compile(r"\boff[-\s]?stage\b", re.I), "outside the frame"),
    (re.compile(r"\bstage[-\s](?:centre|center)\b", re.I), "centred in the frame"),
    (re.compile(r"\bstage[-\s]left\b", re.I), "on the left of the frame"),
    (re.compile(r"\bstage[-\s]right\b", re.I), "on the right of the frame"),
    (re.compile(r"\bup\s?stage\b", re.I), "toward the back of the frame"),
    (re.compile(r"\bdown\s?stage\b", re.I), "toward the front of the frame"),
    (re.compile(r"\bcamera[-\s]left\b", re.I), "on the left of the frame"),
    (re.compile(r"\bcamera[-\s]right\b", re.I), "on the right of the frame"),
]

\# A quoted span is diegetic and load-bearing (SKILL.md L136-138): it must render verbatim, so the
\# table is applied only to the UNQUOTED spans between them.
_QUOTED_SPAN = re.compile(r'"[^"\n]{1,60}"' r"|'[^'\n]{1,60}'")

_RESIDUAL = re.compile(r"\b(stage|wings|blocking)\b", re.I)
_DIRECTION_NEAR = re.compile(r"\b(left|right|centre|center|front|back|up|down|mark)\b", re.I)


def translate_idiom(text):
    """Apply IDIOM_TABLE to every unquoted span of `text`; quoted literals pass through untouched."""
    out, pos = [], 0
    for m in _QUOTED_SPAN.finditer(text or ""):
        out.append(_translate_span(text[pos:m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(_translate_span((text or "")[pos:]))
    return "".join(out)


def _translate_span(span):
    for pattern, replacement in IDIOM_TABLE:
        span = pattern.sub(replacement, span)
    return span


def residual_idiom(text):
    """WARN-level scan for staging idiom the table cannot claim to cover. Never raises: the table
    is not provably exhaustive and hard-failing on authored prose would block legitimate shots."""
    hits = []
    for m in _RESIDUAL.finditer(translate_idiom(text or "")):
        window = (text or "")[max(0, m.start() - 40):m.end() + 40]
        if _DIRECTION_NEAR.search(window):
            hits.append(window.strip())
    return hits
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 18 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): staging-idiom translation table + residual WARN scan"
```

---

## Result

VERDICT: NEEDS-FIXES

1. PASS — prescribed suite: 20 passed; no real Codex invoked.
2. FAIL — all plan mappings use exact targets, but P2b’s winning phrase “at stage-left of frame” becomes malformed: “at on the left of the frame of frame.” The report’s no-conflict claim is incorrect.
3. FAIL — normal poisoned staging text detects `wings`/`blocking`, but a prior translation shifts offsets and can hide a nearby residual idiom.
4. FAIL — tests catch a dropped table row, but do not catch either demonstrated regression.
5. PASS — HEAD changes exactly the two named files; forge.py has identical blobs; AST import pin unchanged; `git diff --check` and entropy scan pass.

Findings:

- MEDIUM: [forge_codex.py:60](/C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py:60) conflicts with P2b’s [worked example:752](/C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/p2b-prompting-research.md:752). Add context-aware translation and a regression test.

- MEDIUM: [forge_codex.py:97](/C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py:97) uses translated-text offsets to slice original text at [line 98](/C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py:98). Poisoned composed prompt `stage-left, left x… wings` returns `[]`; add this regression case.
