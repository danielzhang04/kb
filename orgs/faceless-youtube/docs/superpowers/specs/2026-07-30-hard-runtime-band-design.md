# Hard pre-render runtime band — design (2026-07-30)

Daniel's ruling: the pre-render runtime estimate (VO words ÷ the channel voice's measured wpm)
is a **hard band, not advice**. The Second Take's band: **7:30–9:30**. Approved in-terminal
2026-07-30 (boss session); this spec records the shape.

## Why

ST-013 shipped GATE 1 at 6:26 after leash cuts removed ~400 words from an 8–10-min draft. The
band existed only as an advisory lint note and a dna aspiration, so nothing failed. A hard floor
makes under-length a mechanical stop the writers-room must resolve (writer pass — additive), and
a hard ceiling keeps the 16–24-min death-zone drift unreachable by increments.

## Mechanism (all channels) / value (per channel)

1. **dna.md owns the value.** The Second Take: `Target length: hard 7:30–9:30` (pre-render
   estimate); the machine-readable `Measured VO wpm: 171` line beside the voiceover config is
   the lint's rate source for the current voice, Chris.
2. **The script header carries it.** long-form-writer Step 4 already copies the channel norm
   into `Target length:`; the band is written in exactly one accepted form: `M:SS-M:SS`,
   `N-M min`, or `N to M min` (hyphen or en dash).
3. **lint_script.py enforces it.** The words-vs-runtime check flips from advisory to **HARD
   violation** when the estimate (words ÷ --wpm) falls outside the header's parsed band. A
   missing band stays advisory-only; a present but unparsable band emits
   `Target length present but unparsable — hard band not enforced`. Existing HARD semantics
   (exit 1) are unchanged.
4. **Doctrine line** (long-form-writer SKILL.md Step 4): the band is hard; an under-floor
   script after editor cuts is an additive remedy that routes to the writer pass — the editor
   never pads.

Rejected: `--band` CLI plumbing (second source of truth), per-channel lint hardcoding (channels
are data, not code).

## ST-013 compliance bounce

Writer-structural pass through long-form-writer on `videos/2026-07-30-diamonds/script.md`:
extend 1,100 words to target ~1,400-1,500 words (comfortable at both 171 and any plausible
re-measure) using ONLY unused research.md ledger material (sightholder/CSO mechanics, the 2004
DOJ industrial plea F-20/21, lab-grown price/size data F-24/26, myths). Then fresh
leash+coherence re-verify on the new spans, humanize, lint hard-clean under the new rule.
Prior 6:26 script archived as `script.r1.md`.
