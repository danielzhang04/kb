"""Plain-assert test for lint_shots.casting_check.
Run: py -3 .claude/skills/visual-prompt-writer/scripts/test_casting_check.py"""
import lint_shots

REG = ["macgregor", "bolivar"]

def flags(shots):
    soft = []
    lint_shots.casting_check("t", shots, REG, soft)
    return soft

# A registry character named in the prompt but not cast -> flagged.
s1 = [{"id": "L01", "still_prompt": "MacGregor holds up the guidebook", "cast": []}]
assert any("L01" in m and "macgregor" in m.lower() for m in flags(s1)), "should flag uncast MacGregor"

# Same character, properly cast -> no flag.
s2 = [{"id": "L02", "still_prompt": "MacGregor holds up the guidebook",
       "cast": [{"character": "macgregor"}]}]
assert flags(s2) == [], "cast MacGregor should not flag"

# No named figure (anonymous crowd prose) -> no flag.
s3 = [{"id": "L03", "still_prompt": "a crowd of settlers on a dock, dot eyes", "cast": []}]
assert flags(s3) == [], "anonymous crowd should not flag"

# A second registry character (Bolivar) named but not cast -> flagged.
s4 = [{"id": "L04", "still_prompt": "Bolivar signs the loan papers", "cast": []}]
assert any("L04" in m for m in flags(s4)), "should flag uncast Bolivar"

# A capitalized NON-registry proper noun (a place) must NOT flag (no noisy heuristic).
s5 = [{"id": "L05", "still_prompt": "a map of Britain and the Mosquito Coast", "cast": []}]
assert flags(s5) == [], "a non-registry place name should not flag"

print("PASS test_casting_check")
