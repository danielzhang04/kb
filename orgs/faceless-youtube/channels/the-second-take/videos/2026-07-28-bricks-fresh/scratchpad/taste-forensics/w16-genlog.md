# W16 — handshake re-roll — generation log

- Date: 2026-08-13
- Scope: one stage-only candidate. No promotion, stamping, registry, manifest, or `refs/base/` mutation.
- Route: `forge.py gen --mode identity --aspect 2:3 --seed refs/base/base.png`, 1K default, per `image-generation/SKILL.md` interaction-primitive recipe.
- Spend cap: $0.100. Historical 1K rate: $0.039.
- Failure policy: 4-minute stall → one re-issue; two `FreeTier limit=0` 429s → halt and report `BILLING`.

## Exact delta prompt

TWO blank bald base mannequins, both in the base costume and base RESTING face, full-body on a plain soft light-grey studio ground. Both heads are EXACTLY the reference image's head — same large round slightly-wide bald skull shape, same proportion of head to body (3 to 3.5 head-widths tall, squat, short legs), same eyes copied exactly (heavy lowered upper eyelids, small pupils set high against the lid, thin level brows) — no almond eyes, no smaller heads, no lankier bodies than the reference. A genuine right-to-right handshake: the LEFT mannequin reaches ACROSS its own body with its right arm; the RIGHT mannequin reaches with its right arm; their hands clasp cleanly at chest height, each hand a classic four-digit cartoon hand. Each free left hand hangs at that figure's outer side. Keep both heads front-facing with no turn: only their pupils look toward the other figure. Medium 3/4 two-shot, both figures on the same plane, no props, no text.

## Exact Forge-assembled provider prompt

Keep this the SAME single character as the reference — INVARIANTS that never change: SAME perfectly bald ROUND head (a soft near-circle, only slightly taller than wide — NOT an egg or oval); the SAME flat head colour AS THE REFERENCE character (the base default is #f5ead6, but a named cast member keeps ITS OWN head tone — never forced to cream); SAME dark warm brown-black outline (#241a12); SAME simple cartoon eyes + thin brows, NO nose, NO ears; SAME simple hands — a classic cartoon hand with exactly THREE fingers plus ONE thumb (four digits total, like a Mickey Mouse / Simpsons hand), NEVER four fingers, NEVER five digits; SAME clean FLAT cel cartoon style, even medium-thick line. Reads unmistakably as the same guy. No text, plain soft light-grey studio background.

TWO blank bald base mannequins, both in the base costume and base RESTING face, full-body on a plain soft light-grey studio ground. Both heads are EXACTLY the reference image's head — same large round slightly-wide bald skull shape, same proportion of head to body (3 to 3.5 head-widths tall, squat, short legs), same eyes copied exactly (heavy lowered upper eyelids, small pupils set high against the lid, thin level brows) — no almond eyes, no smaller heads, no lankier bodies than the reference. A genuine right-to-right handshake: the LEFT mannequin reaches ACROSS its own body with its right arm; the RIGHT mannequin reaches with its right arm; their hands clasp cleanly at chest height, each hand a classic four-digit cartoon hand. Each free left hand hangs at that figure's outer side. Keep both heads front-facing with no turn: only their pupils look toward the other figure. Medium 3/4 two-shot, both figures on the same plane, no props, no text.

## Ledger

| Step | API calls | Spend | Result |
| --- | ---: | ---: | --- |
| preflight | 0 | $0.000 | clean: 1 prompt assembled; output target and base seed resolved; 0 API calls and 0 files written |
| handshake-w16-rerun-candidate | 1 | $0.039 | OK → `visual-kit/_staging/handshake-w16-rerun-candidate.png` (completed within the 4-minute ceiling; no re-issue) |

**Total: $0.039 / $0.100.** No provider errors, 429s, stalls, re-issues, promotion, stamping, or mutation under `refs/base/`.

## Deviation

The first attempt to start a background monitor failed before `forge.py` launched because this Windows shell exposed duplicate `Path` / `PATH` entries to `Start-Process`. It made no provider call and created no candidate. The direct Forge invocation then completed normally.
