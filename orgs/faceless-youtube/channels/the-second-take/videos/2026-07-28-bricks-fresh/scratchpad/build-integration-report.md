# Build integration report — bricks doctrine reset (2026-08-04)

Worktree `kb-worktrees/boss-bricks-reset`, branch `claude/bricks-doctrine-reset`. Edits only, no
commit (boss stages/commits). Closed the three known seams between build workers A/B/C/D's outputs.

## SEAM 1 — stale doc lines (`.claude/skills/image-generation/SKILL.md`)

Swept the whole file for `§2e`/`anon_foreground`/`BASE-RIG`/held-figure-wording remnants of the
abolished third figure tier (confirmed dead per worker A's report: `_BASE_RIG_ANCHOR`, `_rig_tail`,
`_has_binding`, `_FIG_BINDING` and the `anon_foreground` half of `figures_expansion` were removed;
`figures_expansion` is now `(figures, crowd_rig)` only). Fixed four spots:

- Line 15: `§2–§2e descriptors` → `§2–§2d descriptors` (style-bible.md has no §2e; confirmed by
  worker C's anchor-heading grep — §2d CROWD-RIG clause is the last descriptor section, then §3).
- Lines 138–144 (Provider-text order paragraph): deleted the `anon_foreground` example
  (`{"anon_foreground": [...], "crowd": true}`), the "§2e named over the entries" expansion
  description, and the delta-beat "held-figure wording" variant (§2e's "give them a distinct
  outfit" carve-out) — none of that machinery exists anymore. Replaced with the landed two-tier
  reality: `figures` declares only `{"crowd": true}`; forge expands the bible's §2d blockquote when
  it's set; `figures.anon_foreground` is a known-but-abolished key the seeding law refuses by name
  (quoted forge's own refusal text: "name the figure in the video's cast (seeded) or stage the
  people at crowd scale (crowd exemplar)"). Kept the true, still-live sentence about a declared
  `figures` field forcing the §2c RIG-HOLD append (verified against `forge.py`'s `should_hold()` —
  `figures` truthy is still one of its three hold signals).
- Lines 283–285 (fresh-eyes review §1 Identity/rig axis): "every seeded figure AND every anonymous
  LARGE/foreground (§2e) figure ... seeded and §2e → FULL rig, against ... anonymous small/background
  → CROWD rig" rewritten to the real two-tier split: "every seeded figure ... named cast → FULL rig
  ... crowd → CROWD rig." No third tier survives anywhere in the identity/rig verdict language.

Left alone (verified live, not part of the abolished §2e machinery): the two "held figure" mentions
at lines 95 and 216 (STEP-1 owns each figure held through a delta chain — a real, current concept
distinct from the removed §2e held-figure *wording*), and "base-rig exemplar" at line 219 (refers to
the live `refs/base/base.png` template, unrelated to the removed BASE-RIG *clause*-parsing
machinery that read a nonexistent style-bible heading).

## SEAM 2 — owner-branding field reconcile (`build_review_artifact.py`)

Read worker B's report + `shots-schema.md` + `lint_shots.py`'s `place_owner_check` directly. Finding:
the landed schema has exactly ONE real place-owner field — `owner_ambiguity` (boolean escape). There
is no `owner_branding` or `place_owner` field anywhere in the landed schema; worker D's
`_OWNER_DECLARED_KEYS = ("owner_branding", "place_owner")` was a documented-but-fictional fallback
written before B's schema landed. The real "owner cue was authored" signal lint actually uses is not
a field at all — `place_owner_check` detects it as an ordinary quoted, alphabetic,
proper-noun-shaped literal (`_TRACKABLE_LITERAL = r"^[A-Za-z][A-Za-z '&/-]{3,}$"`) in `still_prompt`.

Changed `owner_branding_declared(shot)` to read exactly that signal: `owner_ambiguity` key presence
(the one real field) OR a quoted trackable literal found in the shot's own `still_prompt` (a small,
documented, non-imported regex mirroring lint's own — same "copied not imported" precedent already
used in this codebase for `SEATED_PRIMITIVE`). Removed the fictional `_OWNER_DECLARED_KEYS` /
`_OWNER_AMBIGUITY_KEYS` tuple and the `figures`-dict fallback (neither field was ever landed inside
`figures` either). One source of truth, no fallback tuple, per the brief.

Updated `test_build_review_artifact.py`: replaced the two tests keyed on the fictional fields
(`owner_branding`, `place_owner`, and the `figures`-nested variant) with one test asserting the real
quoted-literal signal, plus a negative case proving a bare backtick cast reference
(`` `zeta-clerk` (`sit`) ``) does NOT false-positive as an owner cue (backticks aren't quote marks).
Updated the `applicable_invariants` and end-to-end `collect()` fixtures to use `owner_ambiguity` /
a real quoted literal (`'Widget Hall'`) instead of the fictional field. Net: 4 owner-branding tests
→ 3 (one was a pure duplicate of the removed `figures`-nesting fallback with nothing left to test).

## SEAM 3 — cross-place refusal wording (`forge.py` + `lint_shots.py`)

Read both exact strings from A's and B's reports, then re-read live from both files to confirm
current text (B's report was already accurate). Picked lint's `place_anchor_same_place_check`
message as the canonical shape — it already names the shot id, the anchored frame's SOURCE place,
and the shot's own DESTINATION place; forge's original only named the shot's own place, never what
place the anchor actually belonged to.

**Canonical law sentence (now identical, verbatim, at both sites):**
> cross-place image seeding is the probe-refuted style-anchor failure (decisions.md 2026-08-04); a
> plate may only seed shots in its own place.

`lint_shots.py`'s `place_anchor_same_place_check` already carried this exact sentence — untouched.
`forge.py`'s `cmd_batch` same-place refusal was rewritten: it now captures `_anchor_place(...)` into
`src_place` (previously computed inline and discarded) and names it in the prefix, then appends the
identical law sentence:
```
{name}: `place_anchor` {anchor} is a frame of place `{src_place or 'none'}`, not this shot's own
place `{declared_place or 'none'}` — cross-place image seeding is the probe-refuted style-anchor
failure (decisions.md 2026-08-04); a plate may only seed shots in its own place.
```
Each side keeps its own context prefix (forge: shot id + anchor path + both place names inline;
lint: `[label] id` + anchor + resolved source shot stem + both place names) — only the law sentence
is now byte-identical. Checked both skills' test suites for hardcoded assertions on the old forge
string (`is not a frame of this shot's place` / `under another name`): none exist —
`test_forge_place_and_gates.py` only asserts substrings `"cross-place image seeding"` and the shot id
`"Y9"`, both still present. No test edits needed for this seam.

Not touched (out of seam-3's file/message scope, a separate 4th inconsistency A's report flagged):
the delta-on-`place_anchor` refusal wording still differs between forge ("a delta inherits the
in-chain parent frame it is a delta OF") and lint ("a delta continues its own base's held scene via
the chain parent") — same condition, different shape, but not the cross-place message this seam
names.

## Test results

```
cd orgs/faceless-youtube/.claude/skills/image-generation/scripts && py -3 -m pytest -q
142 passed
```
(143 → 142: seam 2's test consolidation removed one duplicate fixture testing a fictional
`figures`-nested fallback that no longer exists; no functional test coverage was lost.)

```
cd orgs/faceless-youtube/.claude/skills/visual-prompt-writer/scripts && py -3 -m pytest -q
194 passed
```

Both suites green, 0 failed.

## Nothing stopped on

All three seams resolved within the given instructions — no design judgment beyond what was briefed
was required. Files touched: `.claude/skills/image-generation/SKILL.md`,
`.claude/skills/image-generation/scripts/build_review_artifact.py`,
`.claude/skills/image-generation/scripts/forge.py`,
`.claude/skills/image-generation/scripts/test_build_review_artifact.py`. No commits made.
