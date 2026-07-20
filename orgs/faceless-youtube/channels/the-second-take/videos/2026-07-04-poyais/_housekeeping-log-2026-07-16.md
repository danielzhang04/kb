# Poyais data-integrity housekeeping — 2026-07-16

Two surgical fixes on Poyais video data (data-integrity agent). NO image-gen, NO skill edits.
All reads/writes explicit UTF-8; edits are BYTE-surgical (files are CRLF / no trailing newline, so a
`json.dump` round-trip would rewrite every line ending to LF — NOT byte-identical → forbidden by
§F-encoding). Verification by codepoint scan, never by eye.

## Serialization facts (measured, all three files)
- `assets/scenes/manifest.json`: indent 2, **CRLF**, **no trailing newline**, UTF-8 (ensure_ascii=False).
- `shots.json`: indent 2, **CRLF** (2699), **no trailing newline**, UTF-8.
- `shots.motion.json`: indent 2, **CRLF** (1472), **no trailing newline**, UTF-8.

---

## TASK 1 — Re-stamp L05/L08/L22 in assets/scenes/manifest.json

### CONFIRM step (before touching)
- (a) Entries exist: L05, L08, L22 all present in manifest `shots[]`. ✓
- (a) Scene files on disk: `assets/scenes/L05.png` (1.38MB), `L08.png` (1.76MB), `L22.png` (1.22MB) all present. ✓
- (b) Why they were `verified:false` originally: each was **regenerated 2026-07-15** and carried
  "NOT REVIEWED" (the agent fresh-eyes axis review was SKIPPED by human directive) — so scene stayed
  false until the human render-gate. STATUS "KNOWN DATA INCONSISTENCY (2026-07-15)" says the re-stamp
  is owed after Daniel human-gated the chunk-1 render.

### DISCREPANCY vs brief (surfaced, not silently proceeded)
- The brief states L05/L08/L22 **carry `verified:false`**. In the CURRENT manifest they are ALREADY
  `{scene:true, rig:true, flagged:false}` — the flag-flip already happened (regen/round-2 on 2026-07-15).
  Each already carries a `gate_note`: "verified via HUMAN gate on the rendered chunk-1 MP4 (2026-07-15,
  Daniel approved)". So the verified/flagged flip is a **no-op** — the target state is already in place.
- What is genuinely still missing / owed: the **re-stamp audit note** in `notes`. That is additive and
  matches the brief's intent exactly, so I completed only that (byte-surgical notes append), leaving
  flags untouched since already correct (§D reuse-before-regenerate). L18/L23 NOT touched.

### DONE
- Backup: `assets/scenes/manifest.pre-restamp-2026-07-16.json` (byte copy, 36311 B).
- Appended to L05/L08/L22 `notes`: ` | re-stamped 2026-07-16 per human-gated chunk-1 render (STATUS known-inconsistency)`.
- VERIFY: JSON valid (41 shots). Only L05/L08/L22 differ from backup; only their `notes` field changed
  (all other fields byte-identical). L18/L23 byte-identical to backup (untouched). CRLF preserved
  (913), no trailing newline preserved, size +252 B (=3×84). Codepoint scan: em dash U+2014 and §
  U+00A7 intact, whole-file U+FFFD count = 0.


---

## TASK 2 — Fix double-encoding mojibake in shots.json

### Matcher normalization learned (render-builder render.py:46, mirrored in lint_shots)
`_NORM = re.sub(r"[^a-z0-9]+","",w.lower())` — lowercases then strips EVERYTHING except a-z0-9.
Needle = first 4 non-empty normalized whitespace-split words of vo_ref. So accents AND mojibake are
both stripped to nothing → the matcher was never actually broken by this corruption; the fix is
correctness/display only, zero anchor-timing risk (proven by token-walk below).

### FULL occurrence list (enumerated programmatically, NOT assumed)
shots.motion.json: ZERO mojibake (U+00C3/U+00C2/U+FFFD all 0) — untouched, no backup needed.
shots.json — 6 flagged string values, 11 mojibake glyphs total (two corruption depths):
  1. .long_form.shots[13].vo_ref (L17)              — Simón ó ×1, Bolívar í ×1
  2. .long_form.shots[13].changed_elements[0] (L17) — Bolívar í ×1
  3. .long_form.shots[13].still_prompt (L17)        — Bolívar í ×3
  4. .long_form.shots[13].notes (L17)               — Bolívar í ×2
  5. .long_form.shots[58].still_prompt (L65)        — £ ×2
  6. .long_form.shots[58].notes (L65)               — £ ×1
Reconciles to raw counts: U+00C3=8 (ó1+í7, the brief's "×8", Simón/Bolívar only) and U+00C2=11 (8 + £3).

- **Simón/Bolívar = DOUBLE mojibake** (triple-encoded). Each glyph = 4 codepoints
  `U+00C3 U+0192 U+00C2 U+00xx` (UTF-8 bytes `C3 83 C6 92 C3 82 C2 xx`) — needs TWO reverse passes.
  The brief's single "latin1->utf8" round-trip would NOT have repaired these (fails on U+0192 'ƒ').
- **£200,000 = SINGLE mojibake** `Â£` (`U+00C2 U+00A3`, bytes `C3 82 C2 A3`) in still_prompt+notes.
  NOT in the brief; surfaced by enumeration. True text confirmed: script.md L36 "two hundred thousand
  pounds" + source S2 "the £200,000 London loan". British pounds correct.

### Method (deviation from brief, justified)
Brief said "load->dump round-trip". REJECTED: all three files are CRLF / no-trailing-newline, and
json.dump emits LF — a round-trip is NOT byte-identical (rewrites 2699 line endings), violating
§F-encoding. Used BYTE-surgical bytes.replace of the exact mojibake byte sequences → correct UTF-8,
longest-pattern-first, with an asserted occurrence count per pattern:
  `C383C692C382C2B3`(1) -> `C3B3` (ó);  `C383C692C382C2AD`(7) -> `C3AD` (í);  `C382C2A3`(3) -> `C2A3` (£).

### DONE + VERIFY
- Backup: `shots.pre-mojibake-fix-2026-07-16.json` (byte copy, 216070 B).
- 11 replacements applied, all asserted-count-exact. CRLF preserved (2699), no trailing newline, size 216016.
- Invariance: exactly 6 leaf values differ from backup (the 6 flagged strings); every other leaf byte-identical.
- Codepoint scan (whole files): shots.json U+00C3=0 U+00C2=0 U+FFFD=0; shots.motion.json 0/0/0.
- Residual non-ASCII in shots.json is ALL legitimate: U+00A3 £×7, U+00A7 §×1, U+00ED í×8, U+00F3 ó×2,
  U+2013 –×2, U+2014 —×231, U+2192 →×3, U+2264 ≤×1 (the L41 note the brief flagged to keep). Left as-is.
- lint_shots.py channels/.../shots.json -> EXIT 0, "HARD violations: none". 32 heads-up = pre-existing
  SOFT (long-span / delta-timing / casting), unrelated to this fix.
- lint_motion_plan.py shots.motion.json shots.json -> EXIT 0, "0 error(s)".
- Matcher token-walk (the two vo_ref occurrences, L17):
    fixed vo_ref     -> ['fighting','alongside','simn','bolvar']
    script.md words  -> ['fighting','alongside','simn','bolvar']   IDENTICAL.
    (old mojibake also normalized to the same needle -> confirms zero anchor impact.)

## Files touched
- assets/scenes/manifest.json (gitignored) — 3 notes appended
- shots.json — 11 mojibake glyphs repaired
- Backups: assets/scenes/manifest.pre-restamp-2026-07-16.json, shots.pre-mojibake-fix-2026-07-16.json
- shots.motion.json — NOT modified (no corruption)
