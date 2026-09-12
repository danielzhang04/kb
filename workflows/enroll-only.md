---
{"id":"enroll-only","default-manager":"prospecting-manager","version":1,"stages":[{"id":"preflight","agent":"prospecting-campaigner","operation":"status","needs":[],"inspect":false},{"id":"enroll","agent":"prospecting-campaigner","operation":"sweep","needs":["preflight"],"inspect":false}]}
---

# Enroll only

Validate approved policy and revision hashes, then create enrollments and T0 Gmail draft requests. It never sends.
