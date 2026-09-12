---
{"id":"personalize-only","default-manager":"prospecting-manager","version":1,"stages":[{"id":"personalize","agent":"prospecting-personalizer","operation":"personalize","needs":[],"inspect":false},{"id":"inspect-personalize","agent":"inspector","operation":"grade","needs":["personalize"],"inspect":true}]}
---

# Personalize only

Create immutable T0 draft revisions for existing eligible opaque IDs and independently inspect them.
