---
name: lesson-writing
description: Append durable, reusable lessons where the next relevant run will load them
when: always
audience: all
read_only: true
budget_bytes: 2200
---
At the end of a run, append to `memory/<agent-id>.md` what worked, what failed and why, and what
remains, with the evidence or condition that makes the lesson reusable.

Write the lesson in the least-general durable location a fresh session loads. Treat raw
transcript signals and candidate lessons as proposals until a human accepts them.

Authority: `CLAUDE.md` memory rules and `docs/proposals/loops/README.md` Loop B doctrine.
