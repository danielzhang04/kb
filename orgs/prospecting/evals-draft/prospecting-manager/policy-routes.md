---
id: policy-routes
capability: prospecting-manager
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_compile_ask.py::test_all_ten_predicates_have_exact_shape_and_stable_ids
---
Compiles every recorded ask to the intended typed policy and route.
