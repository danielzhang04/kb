# Fix worker G3 — seed-cap displacement PRIORITY ORDER

Worktree `C:/Users/danie/kb-worktrees/boss-bricks-reset`, branch `claude/bricks-doctrine-reset`.
Nothing committed, nothing generated, no provider call, $0. Implements the boss ruling on
`fix-G2-report.md`'s seed-cap exercise before act-2 authoring needs it.

## The landed order

`forge.py`'s `cmd_batch` walk (the per-shot slate builder) now runs an ORDERED, multi-step drop
within `SEED_CAP` (4) instead of the old single crowd-only displacement — one seed at a time,
stopping the instant the slate fits, never dropping more than the overage requires:

1. **Crowd exemplar** — only when a place/parent role is also present in the slate (the place
   frame already carries the rear mass in pixels; condition unchanged from before this fix).
2. **Interaction template** — its contact geometry is also carried in the shot's own authored
   prose and in the two named figures' own STEP-1 cards, so the pixel template is reinforcement,
   not the geometry's only carrier. Dropping it also adds its tag to `assets_omitted`, which
   `interaction_violations` already reads to legally exempt an omitted template from the
   "names it but does not seed it" check — no parallel bookkeeping needed.
3. **Tagged prop** (kind `prop` only, never `environment`) — the prompt already names it by its
   own backticked slug; forge's derived prop seed is a reinforcement, not its only carrier.

**Never droppable, at any step:** the place plate/chain parent, the derived §5 lettering exemplar
(LOCKED), or any character STEP-1. Every drop is recorded in both `why` and `assets_omitted` — the
same bookkeeping the single-step version already used, extended rather than paralleled.

If the slate still exceeds the cap once all three steps are exhausted, `seeding_law_violations`'s
over-cap message now distinguishes two cases: when every seed still present is non-droppable in
context (no crowd role with a place beside it, no interaction role, no prop role), it refuses
naming the **true bind — cast count against `SEED_CAP`** — never a specific "did not fit" seed,
and never advises restaging with fewer cast. A hand-authored spec with no role metadata (never
walked through displacement) keeps the old positional message, since role identity is unknown
there and a droppable seed may genuinely still be present.

## The two 6-seed fixture resolutions (G2's shapes, `test_forge_place_and_gates.py`)

- **Interaction variant** (`test_the_interaction_shape_resolves_by_two_ordered_drops`): 2 named
  cast + `handshake` interaction template + place + crowd + derived lettering (a quoted literal
  on the whiteboard) = 6 seeds, over cap by 2. Resolves via crowd dropped, then `handshake`
  dropped → 4 legal seeds (2 STEP-1 figs + place plate + lettering exemplar).
  `assets_omitted == ["crowd-exemplar", "handshake"]`; `why` carries both `CAP DISPLACEMENT` lines.
- **Prop variant** (`test_the_prop_shape_resolves_by_two_ordered_drops`): 2 named cast + place +
  crowd + derived lettering + tagged `prop-drive` = 6 seeds, over cap by 2. Resolves via crowd
  dropped, then `prop-drive` dropped → 4 legal seeds. `assets_omitted ==
  ["crowd-exemplar", "prop-drive"]`.

## The never-droppable law test

`test_never_droppable_seeds_refuse_naming_cast_count_not_a_locked_seed`: 3 named cast (3 STEP-1s,
no crowd/interaction/prop anywhere) + place + derived lettering = 5 seeds, over cap by 1, with
nothing legal left to drop — the slate only fits if the LOCKED lettering exemplar is dropped,
which the law forbids. Asserts the refusal:
- contains `"5 seeds over the cap of 4"` and `"cast count"` and `"3 named-cast seed(s)"`
- does **not** contain `"did not fit"` or the literal `"lettering-marker-italic"` anywhere

## Final refusal wording (genuinely-stuck case)

```
<name>: 5 seeds over the cap of 4 after every legal displacement (crowd exemplar, interaction
template, tagged prop) has already been dropped where present — 3 named-cast seed(s) plus the
place plate/chain parent and, if text-bearing, the locked §5 lettering exemplar are what remain.
Nothing is truncated and no locked seed is dropped: the true bind is cast count against
`SEED_CAP`, not a misfit seed.
```

The old "restage the shot (fewer cast) rather than drop a seed" line is gone from every branch —
the fallback (hand-authored spec, no role metadata) now reads "restage the shot rather than drop
a seed" with no casting-specific advice.

## Two pre-existing tests updated (both now legally resolve, not refuse)

Two existing fixtures assumed the old single-step behavior and needed re-shaping, not just a
message-string update, because the new order genuinely resolves shapes it used to refuse:

- `test_forge_place_and_gates.py::test_a_shot_still_over_cap_after_displacement_is_restaged_never_truncated`
  → renamed `..._after_all_legal_drops_is_restaged_never_truncated`. Its old 6-seed shape (2 cast +
  place + crowd + `prop-beige-pc` + `stamp-block-outlined`) now legally resolves to 5 via crowd +
  prop drops (not 4, since `stamp-block-outlined` is `environment` kind, never a displacement
  target) — added a text-bearing literal so lettering joins the irreducible remainder, keeping the
  fixture genuinely stuck at 5 for a real "restage" refusal.
- `test_forge_seed_requirement.py::test_explicit_tags_over_cap_still_hard_error_instead_of_truncating`
  → its old fixture included `prop-beige-pc`, which the new step 3 now legally drops regardless of
  place. Removed the prop tag (kept only the two `environment` tags, both non-droppable) and added
  a second named cast member so the shape is still genuinely over cap with nothing legal to drop
  (T01 declares no `place`, so step 1's crowd drop can't fire either).

## Suite counts

- `image-generation/scripts`: **184 passed** (was 181 — 3 new: the two 6-seed fixtures + the
  never-droppable law test; 2 pre-existing tests re-shaped in place, no net count change from
  those).
- `visual-prompt-writer/scripts`: **253 passed**, unchanged (doc-only edit in that skill; its test
  suite doesn't import forge).

## Docs updated

- `image-generation/SKILL.md` — the batch-specs paragraph (previously: "never truncates — an
  over-cap or under-seeded shot is a hard error naming the shot and the seed that did not fit")
  now states the ordered 3-step displacement, the never-droppable list, and the true-bind refusal
  wording in place of "fewer cast" advice.
- `visual-prompt-writer/SKILL.md` — the seed-cap worked example (§3, "Seed-cap displacement") now
  states the full priority order and both 6-seed shapes (interaction and prop variants) resolving
  via two ordered drops, alongside the original 5-seed one-drop example.

## Files touched

- `orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py`
- `orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_place_and_gates.py`
- `orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_seed_requirement.py`
- `orgs/faceless-youtube/.claude/skills/image-generation/SKILL.md`
- `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/SKILL.md`

No other files touched. Nothing staged, nothing committed, per brief.
