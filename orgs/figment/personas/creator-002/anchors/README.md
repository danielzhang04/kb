# Creator-002 acceptance anchors

These three JPEGs are deliberately synthetic, flat-colour PIL placeholders for
the on-disk creator-002 acceptance fixture. They are not photographs of a real
person and must not be used as production identity references or sent to a live
pod. The acceptance test uses them to prove that a clean checkout can load the
persona and exercise the local dry-run, grading, and gate command surface.

`make_placeholders.py` is an idempotent generator for the files. Replace the
placeholders with an operator-provided anchor shoot before any live use, then
update the persona's identity-spec and reference review records through the
normal anchor gate.
