# P4 probe 7 — canvas rows

Date: 2026-08-11. Branch `claude/codex-image-engine`.

## Measurement

The plan's dimension-histogram command was run unchanged. It measured every PNG under the
Gemini baseline and the video assets tree. The assets tree contained no PNGs at measurement time.

```text
1376x768  ratio=1.7917  n=23
```

## SHA re-verification

The plan's SHA re-verification command was run unchanged:

```text
MISMATCHES: none
```

## Verdicts

- `(16:9,1K)` **VERIFIED 1376×768 (n=23)**
- `(2:3,1K)` **UNVERIFIED — carried from SKILL.md L130; no codex frame at this ratio may be promoted at P5 until a real Gemini frame of that ratio is measured (§8.5 probe 7)**
- `(9:16,1K)` **UNVERIFIED — carried from SKILL.md L130; no codex frame at this ratio may be promoted at P5 until a real Gemini frame of that ratio is measured (§8.5 probe 7)**

No deviations from the plan's commands were required. No generations or network calls were made.
