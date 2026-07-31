# Follow-up: margin re-extend + three precision fixes (adversarial review findings)

An adversarial review flagged your 1,290-word script as too thin a margin: 7:33 at 171 wpm is 10
words above the hard floor, and it FAILS at 175 wpm (the superseded-but-present other figure).
Extend back to **1,400–1,500 words** so the estimate is comfortable at both 171 and 175
(at 175, ≥1,313 words is the floor; land well clear). File:
channels/the-second-take/videos/2026-07-30-diamonds/script.md (cwd = the worktree).

How to extend: restore/redevelop tightened beats from ledger material — you know which spans the
humanize+dwell rounds compressed; rebuild the best of them as full idea-block beats (the CSO
texture, the stockpile squeeze, the myths material are still under-used). Leash absolute; no
padding of existing sentences; staged order; no em dashes; no hedges; the three dwell repeats you
collapsed STAY collapsed (scope once, no echo, no summary restatement).

Three precision fixes from the review, apply exactly:
1. "De Beers Centenary, another company in the De Beers group" — the ledger does not establish
   corporate structure. Rephrase so the connection rides the shared NAME without asserting group
   membership (e.g. a company called De Beers Centenary), keeping the separate-case framing.
2. "turning the diamond engagement ring into a psychological necessity" — F-09's reported wording
   is STRENGTHENING the tradition into a psychological necessity; match the ledger's verb.
3. The 20-percent beat: F-24 dates the ~20% discount to 2018 and marks it approximate — say
   "about 20 percent" and anchor the year 2018 (this also makes bounce-changelog.md's claim true).

Then run from orgs/faceless-youtube the lint at BOTH `--wpm 171` AND `--wpm 175`: each must EXIT 0
with the estimate inside 7:30-9:30. Update the runtime header to the 171 string (the channel's
measured rate). Append changes to bounce-changelog.md under `## Margin re-extend + review fixes`
(and correct its 2018 line).

Final message: word count, both runtime estimates (171 and 175), both lint exits, the beats you
rebuilt, confirmation of the three precision fixes.
