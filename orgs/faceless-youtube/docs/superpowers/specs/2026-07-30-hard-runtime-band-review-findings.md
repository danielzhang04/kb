# PR #107 adversarial review — findings record (2026-07-30, opus reviewer, verdict REQUEST CHANGES)

Companion to `2026-07-30-hard-runtime-band-design.md`. Fix waves were dispatched the same evening
(see the handoff `handoffs/2026-07-30-fyt-band-bounce-paused.md`); a resuming terminal verifies
each item below is closed before the PR merges. Delete this file when #107 merges clean.

## HIGH (both must close before merge)

1. **Hard band inert in the pipeline's own invocation.** `agents/fyt-runner.md:318` (+ stage-3
   Done criterion "÷ 150", gate spine ~:142/:164) and `long-form-writer/references/critics.md:52`
   invoke lint WITHOUT `--wpm` — the exact fail-open condition (`lint_script.py:272` requires
   `wpm_given`). Fix: those docs pass `--wpm <channel measured wpm>`; Done criterion names the
   measured wpm, not 150.
2. **Undeclared wpm value + 10-word floor margin.** dna.md carries "~175 gross wpm" (:73,
   Miles-era) AND "~171 wpm measured" (:122, YAML comment); no machine-readable field. Script at
   1,290w = 7:33@171 passes but FAILS at 175 (7:22). Fix: explicit `Measured VO wpm: 171` line in
   dna.md, 175 marked superseded; SKILL.md/fyt-runner name it as the --wpm source; script
   re-extended to ~1,400–1,500w so both rates pass.

## MEDIUM

3. Legacy Second-Take script headers carry stale bands that now hard-fail (silver-fresh: passes
   the real 7:30-9:30 but fails its stale `8-10 min` header). Fix: sweep live script.md headers
   to `7:30-9:30` (never *.rN.md archives, never other channels).
4. Unparsable band = SILENT no-op (e.g. `7:30 to 9:30` MM:SS form unsupported); reversed band =
   unsatisfiable gate; `M:SS` seconds field accepts 7:99. Fix: soft advisory on
   present-but-unparsable, reversed→unparsable, seconds 00-59; SKILL.md form list matched to code.
5. `critics.md:55` still documents the check as "a heads-up, not a failure". Fix: one line.

## LOW (content precision, ledger discipline)

- script.md:42 "another company in the De Beers group" — corporate structure not in ledger;
  connection must ride the shared name only.
- script.md:24 "turning ... into a psychological necessity" — F-09 says STRENGTHENING the
  tradition into; match the verb.
- script.md:48 drop of F-24's "about" + bounce-changelog claims a 2018 baseline the script never
  states (F-24 does date it 2018 — add the year, keep "about").
- lint: no cross-check that the header's Estimated runtime VALUE matches the computed one.
- Spec's ST-013 word target (1,450–1,550) vs delivered 1,290 — reconcile after re-extend.

## Reviewer-named untested lint paths (tests to add)

Unparsable-band-present advisory; reversed band; legacy combined header line
(`- **Target length:** 12-15 min · **Estimated runtime:** 9:24 (...)`); `__main__` arg forms
(`--wpm=171` exits 2 — no argparse); rounding agreement pin; 100-char truncation.

## Verified clean (do not re-litigate)

Parser arithmetic + inclusive boundaries; CLI failure modes loud; YMYL content spot-check of all
high-risk beats (plea scope/fine/years, 20→80% arc, Axios figures, 80%-of-rough-supply wording);
script.r1.md archive byte-identical (blob 73830cc); disclaimer present; no em dashes.
