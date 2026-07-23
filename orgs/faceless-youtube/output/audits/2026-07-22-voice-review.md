# Voice-lane audit — 2026-07-22

**Status:** DRAFT — read-only technical review

## Scope and method

- **Review target:** `6dd5dfa` (`feat(fyt): plan expressive voice delivery safely`) against base `5c901947`; design source `5857709`.
- **Changed files reviewed in full:** `voiceover/SKILL.md`, `voiceover/references/voiceover-contract.md`, `voiceover/scripts/voiceover.py`, and `voiceover/scripts/test_voiceover.py`.
- **Constraints:** read-only review; local/dry verification only. No ElevenLabs request, credentials, paid generation, artifact edit, card/state/decision/ledger change, or commit.
- **Review plan:** (1) trace design requirements to implementation and contracts; (2) inspect CLI callers, configuration precedence, chunking, metadata, cleanup, and failure paths; (3) run focused local tests and dry-runs; (4) record only finding-gate-qualified issues.

## Incremental evidence

- Repository preamble: `python scripts/preamble.py` — **PASS** (`PREAMBLE OK`).
- Context read: root/project constitutions, project contract, operating law, live skill registry/design rules, latest 2026-07-22 resume handoff, engagement handoff/design, channel DNA, storytelling grammar, and decision history relevant to the voice lane.
- Baseline/head topology: merge base of `5c901947` and `6dd5dfa` is `5c901947`; review worktree is on `codex/poyais-engagement-resume` at `cb37cb6`, whose only successor change is the resume handoff. The four in-scope implementation files match `6dd5dfa`.

## Findings (incremental)

### MEDIUM — Existing pause/beat cues are falsely rejected as adjacent delivery markers

- **Location:** `orgs/faceless-youtube/.claude/skills/voiceover/scripts/voiceover.py:158,181-182,192-193`
- **Kind:** correctness regression / design noncompliance; the new marker-placement guard blocks a documented valid composition.
- **Trigger:** place an allowed delivery marker at the next sentence after an existing `[PAUSE]` or `[BEAT]`, for example:

  ```text
  The reveal lands. [PAUSE]

  [emote: curious] What happened next?
  ```

- **Bad outcome:** `clean_markers(..., is_v3=True)` raises `ValueError: Expressive delivery markers may not be adjacent` before dry-run or synthesis. `[PAUSE]` / `[BEAT]` are rhythm cues, not another delivery marker; this makes the feature unavailable at precisely the reveal and mood turns where the design permits it. The same failure occurs for `[BEAT]`.
- **Evidence and guard inspected:** the broad `_EXPRESSIVE_ADJACENCY_RE` is `\]\s*\[(?:emote|aside)\b`, so any preceding bracketed cue is treated as an expressive marker. Even after narrowing that expression, the subsequent `before[-1] not in ".!?"` guard would still reject a preceding pause tag. Existing channel scripts routinely end a turn with `[PAUSE]`/`[BEAT]` (for example `channels/the-second-take/videos/2026-07-10-bricks/script.md:30` and `:45`); the new design explicitly retains punctuation/cue rhythm while allowing sparse markers at reveals. The new tests cover two delivery markers next to each other but not a pause/beat plus one delivery marker.
- **Smallest infrastructure fix:** make adjacency apply only when both bracketed tokens are expressive markers, and have placement validation ignore/normalize permitted pause cues before deciding whether the preceding spoken sentence ended. Add table-driven tests for `[BEAT]` and `[PAUSE]` followed by each allowed marker, while retaining rejection of two delivery markers.

### MEDIUM — Dry-run validates expressive markup outside the spoken region, so its safety check can reject a script that production synthesis accepts

- **Location:** `orgs/faceless-youtube/.claude/skills/voiceover/scripts/voiceover.py:202-208,285-296,677-682,715-718`
- **Kind:** correctness regression / misleading dry-run validation.
- **Trigger:** a non-spoken `## SOURCES / ACCURACY NOTE` tail contains a literal marker example, such as `Editorial note: do not use [emote: excited] in narration.`
- **Bad outcome:** `extract_long_form()` correctly returns only the spoken `The story lands.`, but `expressive_cleanup_summary(raw)` validates the complete source file and raises `ValueError` for the tail example. Thus `--dry-run` fails although normal synthesis validates only the extracted voice region and can proceed, breaking the prescribed zero-spend proof of the paid request shape.
- **Evidence and guard inspected:** `_region()` stops the long-form voice region at the next `##` heading and `clean_markers()` validates that extracted region. The dry-run-only call at lines 677-682 instead passes the whole `script.md` to `expressive_cleanup_summary()`. Local no-write probe reproduced the divergent behavior above. The same pattern exists for shorts at lines 696-703.
- **Smallest infrastructure fix:** compute the cleanup summary from the already extracted raw VO region (or make the summary accept the cleaned/planned v3/v2 texts) for both long-form and shorts. Add a dry-run fixture with an unspoken sources/notes marker example and assert successful planning plus no request.

## Requirement mapping

| Design / contract requirement | Evidence inspected | Result |
| --- | --- | --- |
| Macro delivery variation without changing narrator or register | Whitelisted text-only delivery directions in `voiceover.py:149-156`; no voice ID/model/default setting changed; channel DNA still owns the one narrator/voice lock. | Met in structure. |
| Sparse whitelist; validate vocabulary, placement, adjacency | `validate_expressive_markers()` at `voiceover.py:176-199`; unit coverage at `test_voiceover.py:143-170`. | Partially met; pause/beat false-positive finding above. |
| v3 maps tags; v2 strips cleanly | `clean_markers()` at `voiceover.py:224-282`; translation/strip tests at `test_voiceover.py:143-152`. | Met for direct text cleanup. |
| Dry-run plans both v3/v2 request shapes, settings, cleanup, and seams without API use | `main()` at `voiceover.py:668-718`, with `synthesize()` dry exit at `590-592`; tests at `182-210`. | Implemented, but full CLI test was infrastructure-blocked and unspoken-tail validation diverges from synthesis (finding above). |
| Prefer substantial chapter/mood seam and flag forced seams | v3 chunk planner `voiceover.py:350-395`; all reported seams require ear review. | Met by code inspection and focused chunk test. |
| Preserve v2 continuity behavior and fallback | `tts_request()` continues to omit context only for v3 (`482-488`); v2 receives marker-stripped text. | Met. |
| Keep paid defaults unchanged; any settings audition stays human-gated | `DEFAULT_VOICE` at `71-80` is unchanged by the commit; docs retain per-channel config and one-chapter/human-ear-gate language. | Met. |
| Preserve one-narrator, third-person/reported-speech, near-zero-exclamation and human-cost constraints | The change only transforms approved non-spoken delivery markup; no writer/channel constraint was relaxed. Channel DNA and storytelling grammar retain the locks. | No regression found in this lane. |
| Manifest/timing compatibility and error behavior | `synthesize()` retains existing stitch/timing fields (`577-610,737-779`); render-builder consumes timings only when an audio path exists (`render.py:308-325`), so dry manifests fall back safely. All selected pieces are parsed before the synthesis loop. | No regression found. |

## Verification evidence

- Unless a repository-root path is shown, commands below ran from `C:\Users\danie\kb\_private\codex-worktrees\poyais-engagement-resume\orgs\faceless-youtube`.
- `python scripts/preamble.py` (repository root) — **PASS**: `PREAMBLE OK`.
- `py -3 -m pytest -q .claude/skills/voiceover/scripts/test_voiceover.py .claude/skills/voiceover/scripts/test_voiceover_shorts.py` — **39 passed, 3 infrastructure errors**. The errors occurred while pytest tried to enumerate `C:\Users\danie\AppData\Local\Temp\pytest-of-danie` for `tmp_path` fixtures (`WinError 5: Access is denied`), before the three affected test bodies ran; no product assertion failed.
- `py -3 -m pytest -q .claude/skills/voiceover/scripts/test_voiceover.py .claude/skills/voiceover/scripts/test_voiceover_shorts.py --basetemp C:\tmp\voiceover-audit-20260722-6dd5dfa` — **39 passed, 3 infrastructure errors**. The requested base-temp parent did not exist (`WinError 3`); no test body failed.
- `py -3 -m pytest -q .claude/skills/voiceover/scripts/test_voiceover.py .claude/skills/voiceover/scripts/test_voiceover_shorts.py -k "not test_probe_measures_real_mp3_and_is_concat_additive and not test_dry_run_reports_v3_v2_plan_and_never_opens_network and not test_main_only_short_01_preserves_existing_long_form_entry"` — **39 passed, 3 deselected**.
- `py -3 -m pytest -q .claude/skills/voiceover/scripts/test_voiceover.py -k "expressive or v3_chunking"` — **13 passed, 9 deselected**.
- Local no-write probes reproduced both findings. They imported only `voiceover.py`, did not create a video artifact, and did not call any network code.
- `git diff --check 6dd5dfa^ 6dd5dfa` — **PASS**. (The broader design change has two trailing-space diagnostics in the design document; they are outside this voice implementation lane.)

## Initial technical lane verdict (pre-fix)

**REQUEST CHANGES.** The delivery feature is otherwise narrowly scoped and preserves its paid defaults and downstream manifest contract, but the two dry-run/marker-validation defects undermine the exact zero-spend validation gate this commit adds.

Smallest fix sequence, in the owning cross-video `voiceover` skill:

1. Correct expressive-marker adjacency and placement normalization so existing `[BEAT]`/`[PAUSE]` cues may precede one approved marker, while two delivery markers remain invalid.
2. Derive dry-run cleanup summaries from only the extracted VO regions for long-form and shorts.
3. Add focused regression fixtures for both cases, then rerun the offline voiceover suite using a writable pytest base-temp.

## Scope / governance notes

- Reviewed in full: `voiceover/SKILL.md`, `voiceover/references/voiceover-contract.md`, `voiceover/scripts/voiceover.py`, and `voiceover/scripts/test_voiceover.py`, plus the design commit and necessary workflow, channel, and render-manifest callers.
- Excluded: all non-voice engagement implementation, Poyais/Wells/Bricks production artifacts, paid TTS, network calls, queue/state/decision/ledger changes, commits, and external actions.
- The latest resume handoff flags the kb wrapper `orgs/faceless-youtube/STATE.md` as stale relative to the project handoff/STATUS; this review did not mutate it because the assignment is read-only.

## Post-fix verification — 2026-07-22

Reviewed the current uncommitted repair in `voiceover.py` and `test_voiceover.py` against the two findings above. No production source or test file was edited by this verifier.

| Prior finding | Post-fix evidence | Result |
| --- | --- | --- |
| Rhythm cue before one approved expressive marker was rejected | `_EXPRESSIVE_ADJACENCY_RE` now requires **both** adjacent tokens to be expressive markers (`voiceover.py:158-160`), while `_TRAILING_RHYTHM_CUES_RE` removes only trailing `[BEAT]`, `[PAUSE]`, or `[PAUSE:LONG]` before placement validation (`:161-163,194-199`). New table-driven test covers all three cues (`test_voiceover.py:173-180`). Direct local probe accepted `The reveal lands. [PAUSE]` followed by `[emote: curious]`. | **Resolved.** Two expressive markers still raise `ValueError: ... may not be adjacent`; a mid-sentence marker still raises `ValueError: ... must appear before a sentence`. |
| Dry-run validated unspoken tails rather than only the request text | `_long_form_region()` / `_short_region()` now isolate source text before both cleanup summary and v3/v2 planning (`voiceover.py:291-353,691-720`). The new long-form fixture asserts a Sources tail with `[emote: excited]` plans successfully with `urlopen` replaced by a failure stub (`test_voiceover.py:223-248`). An independent short-only CLI fixture with an `## NOTES` tail produced `short-01 cleanup: no expressive markers`, transcript exactly `The short lands.`, and a dry-run manifest (`audio: null`). | **Resolved.** No network path opened: the unit tests replace `urllib.request.urlopen` with a raising stub, and the CLI reported `DRY-RUN: no ElevenLabs request will be made.` |

### Post-fix verification commands

All commands ran from `C:\Users\danie\kb\_private\codex-worktrees\poyais-engagement-resume\orgs\faceless-youtube`.

- `py -3 -m pytest -q .claude/skills/voiceover/scripts/test_voiceover.py .claude/skills/voiceover/scripts/test_voiceover_shorts.py --basetemp ..\..\.pytest-tmp-voice-fix\postfix-review` — **46 passed, 0 failed, 0 skipped**.
- `py -3 .claude\skills\voiceover\scripts\voiceover.py ..\..\.pytest-tmp-voice-fix\postfix-manual-short\channels\test\videos\marker-tail --dry-run --only short-01` — **PASS**, zero provider request; short-only unspoken-tail behavior verified as described above.
- Local no-write marker probe — **PASS**: cue-plus-one-marker accepted; two delivery markers and a mid-sentence delivery marker remain hard errors.

Both worktree-local temporary fixture directories (`.pytest-tmp-voice-fix/postfix-review` and `postfix-manual-short`) were removed after verification. No network call, paid TTS, production artifact, source/doc/status/decision/card/ledger edit, or commit occurred.

## Revised technical lane verdict

**READY.** Both prior MEDIUM findings are resolved by narrow cross-video `voiceover`-skill fixes with focused regression coverage. No new finding-gate-qualified regression was found in the repaired paths.
