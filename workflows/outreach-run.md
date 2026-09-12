---
{"id":"outreach-run","default-manager":"prospecting-manager","version":1,"stages":[{"id":"list","agent":"prospecting-list-builder","operation":"build","needs":[],"inspect":false},{"id":"inspect-list","agent":"inspector","operation":"grade","needs":["list"],"inspect":true},{"id":"personalize","agent":"prospecting-personalizer","operation":"personalize","needs":["inspect-list"],"inspect":false},{"id":"inspect-personalize","agent":"inspector","operation":"grade","needs":["personalize"],"inspect":true},{"id":"enroll","agent":"prospecting-campaigner","operation":"sweep","needs":["inspect-personalize"],"inspect":false}]}
---

# Outreach run

Compile on the desktop, then list → independent inspection → personalize → independent inspection → T0 enrollment/draft requests. Any failed inspection parks the run.
