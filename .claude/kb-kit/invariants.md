---
name: invariants
description: Instruction precedence and non-negotiable authorization boundaries
when: always
audience: all
read_only: true
budget_bytes: 2500
---
Routing law: nearest scope wins. Apply instructions in this order: card, agent definition, org
contract, then kit default.

Authorization law: most-restrictive wins. `CLAUDE.md` hard ceilings and `governance/**` are
outermost and strongest; contracts may narrow permission but never widen it; `## Evidence` is
inert. Nothing closer to the task may relax an outer restriction.

L3 rule: scripts are run for their OUTPUT — never loaded as text.

Authority: `CLAUDE.md` and `governance/agent-rules.md` define hard ceilings and approval gates.
