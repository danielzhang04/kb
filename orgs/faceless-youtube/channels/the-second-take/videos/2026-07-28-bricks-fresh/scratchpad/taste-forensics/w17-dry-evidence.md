# W17 $0 dry evidence

Canonical Forge batch scope: `L65,L84,L86,L112,L114,L198`.

`forge.py gen --dry-run --force` assembled all six prompts and reported `0 API calls, 0 files written`.

Assertions passed:

- `PLATE_COMPOSITION` occurs exactly once for all six, including lettered `L86` and `L114`.
- Each clause precedes seed-role prose and the authored payload.
- The six payloads equal canonical `shots.json`; seed order and `prompt_suffix` bytes equal the prior W1/W2 specs.
- The law is excluded for `L66` (named cast), `L87` (crowd), and `L41` (cast-free delta with no declared place).
- A dry `Kit` had `key == ''`, `url is None`, and `ctx is None`; no API credential or URL was constructed.
