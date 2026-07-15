from validate_recipe import parse_frontmatter, validate, REQUIRED_KEYS

GOOD = """---
inputs: prior stage X + research Y
reuse_check: skill Z
option_shape: 3 boards
critic_checks: differentiated
routes_to: idea-generator
gate: pick one
---

Body guidance here.
"""


def test_required_keys_shape():
    assert REQUIRED_KEYS == ["inputs", "reuse_check", "option_shape", "critic_checks", "gate"]


def test_routes_to_is_optional():
    # a recipe with no routes_to (playbook-authored stage) is still valid
    text = GOOD.replace("routes_to: idea-generator\n", "")
    assert validate(text) == []


def test_parse_frontmatter_reads_keys():
    fm = parse_frontmatter(GOOD)
    assert fm["inputs"] == "prior stage X + research Y"
    assert fm["routes_to"] == "idea-generator"


def test_valid_recipe_has_no_errors():
    assert validate(GOOD) == []


def test_missing_frontmatter_errors():
    errs = validate("no frontmatter here")
    assert errs  # non-empty


def test_missing_key_errors():
    text = GOOD.replace("gate: pick one\n", "")
    errs = validate(text)
    assert any("gate" in e for e in errs)


def test_empty_value_errors():
    text = GOOD.replace("inputs: prior stage X + research Y", "inputs:")
    errs = validate(text)
    assert any("inputs" in e for e in errs)
