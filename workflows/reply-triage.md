---
{"id":"reply-triage","default-manager":"prospecting-manager","version":1,"stages":[{"id":"scan","agent":"prospecting-campaigner","operation":"scan","needs":[],"inspect":false},{"id":"reconcile","agent":"prospecting-campaigner","operation":"status","needs":["scan"],"inspect":false},{"id":"human-gate","agent":"human","operation":"review","needs":["reconcile"],"inspect":false}]}
---

# Reply triage

The desktop executor invokes the inbound processor, persists local stops/reply revisions/labels, returns typed classes only, and stops at a human gate.
