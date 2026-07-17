Current (`governance/card-schema.md`, line 25):

```
role: work|consolidate    # consolidate = judge card: scores/picks/merges its
```

Proposed replacement (same line):

```
role: scout|manage|work|inspect|consolidate    # consolidate = judge card: scores/picks/merges its
```

This must land with, or just before, Task 4.4 (`scripts/cards.py` role-enum validation): 4.4 adds `ROLES = ("scout","manage","work","inspect","consolidate")` to the validator, and until this schema line is broadened to match, the documented schema and the enforced validator disagree about which roles are legal.
