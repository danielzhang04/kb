# PENDING WORKER BRIEF — code/docs fix leg for PR #107 (re-dispatch verbatim)

Dispatched 2026-07-30 late to an opus subagent, killed mid-read at Daniel's pause. A resuming
terminal re-dispatches this brief to a fresh **opus** worker (Agent tool), then deletes this file
when the work is harvested. The paired content leg is
`channels/the-second-take/videos/2026-07-30-diamonds/scratchpad/pending-brief-margin-rebounce.md`
(codex-deep, `--follow-up 019fb5fe-36e4-7c62-abf2-a316d4ef5ea3` — repeat `--model codex-deep`).

---

Build worker. Worktree C:\Users\danie\kb-worktrees\boss-band-bounce (branch claude/band-bounce).
Never commit/stage/push; never touch C:\Users\danie\kb. UTF-8 explicit. An adversarial review
returned REQUEST CHANGES; apply these fixes exactly. All paths under the worktree.

1. HIGH-1 wiring: agents/fyt-runner.md line ~318 (stage-3 lint command) + the stage-3 Done
   criterion (currently "÷ 150") + the gate spine mentions (~:142, :164 — check context): the
   lint invocation becomes `py -3 .claude/skills/long-form-writer/scripts/lint_script.py
   <video_dir>/script.md --wpm <measured VO wpm from the channel's dna.md>` and the Done
   criterion references the channel's measured wpm, not 150. Also
   orgs/faceless-youtube/.claude/skills/long-form-writer/references/critics.md ~:52: same
   command gains --wpm; and ~:55 the "a heads-up, not a failure" description of
   words-vs-runtime updates to: hard when the header declares a parsable band and --wpm is
   given, advisory otherwise (MEDIUM-5).

2. HIGH-2 value: orgs/faceless-youtube/channels/the-second-take/dna.md — add one explicit
   machine-readable line in the Voice/voiceover area: `Measured VO wpm: 171` (Chris, the current
   locked voice; note it supersedes the ~175 figure which was Miles). Find the "~175 gross wpm"
   mention (~:73, in the old Miles rationale) and mark it clearly as the superseded Miles-era
   figure so no operator reads it as current. SKILL.md Step 4 (long-form-writer) names this dna
   line as the --wpm source.

3. MEDIUM-3 header sweep: for every channels/the-second-take/videos/*/script.md (live script.md
   files ONLY — never *.rN.md archives, never other channels): set the header's Target length
   band to `7:30-9:30`. Verify each file's estimate against the new band at 171 wpm afterward
   and REPORT any that now fail (do not edit their prose; report only). Expected: poyais 7:44
   pass, silver-fresh 7:55 pass, nikola + bricks-fresh — check.

4. MEDIUM-4 + LOWs in lint_script.py: (a) when a `Target length:` line exists but no band
   parses → append a soft advisory "Target length present but unparsable — hard band not
   enforced"; (b) reversed band (floor>ceiling) → treat as unparsable (same advisory path);
   (c) MM:SS seconds field must be 00-59 else unparsable; (d) SKILL.md's accepted-forms list
   corrected to exactly what the code accepts (M:SS-M:SS, N-M min, N to M min; hyphen or en
   dash). Keep style/register of the file.

5. Tests (test_lint_script.py): add the reviewer's named untested paths: unparsable-band-present
   → advisory appears + exit 0 (when nothing else hard); reversed band → advisory not hard-fail;
   seconds>59 → unparsable; the real legacy header shape (one line carrying
   `- **Target length:** 12-15 min · **Estimated runtime:** 9:24 (...)`) parses the band
   correctly; a subprocess-level test of the __main__ block covering `--wpm 171` (works) and
   `--wpm=171` (exits 2) is optional — include if quick, skip with a note if awkward.

6. Spec reconcile: docs/superpowers/specs/2026-07-30-hard-runtime-band-design.md ST-013 section:
   the content leg is being re-bounced in parallel to ~1,400-1,500 words; update the spec's
   numbers to "target ~1,400-1,500 words (comfortable at both 171 and any plausible re-measure)"
   and note the wpm source line in dna.

Run from orgs/faceless-youtube: the full test file (must pass) + lint on the diamonds script at
BOTH --wpm 171 and --wpm 175 and report both exit codes (the parallel content leg is responsible
for making 175 pass; just report). Report per-file diffs, test output tail, the header-sweep
results.
