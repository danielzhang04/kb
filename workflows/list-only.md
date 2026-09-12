---
{"id":"list-only","default-manager":"prospecting-manager","version":1,"stages":[{"id":"list","agent":"prospecting-list-builder","operation":"build","needs":[],"inspect":false},{"id":"inspect-list","agent":"inspector","operation":"grade","needs":["list"],"inspect":true}]}
---

# List only

Build and independently inspect a list, then return aggregate counts.
