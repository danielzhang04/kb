"""Plain-assert test: a prop-canonical seed must not trigger the §2c rig-hold auto-append.
Run: py -3 .claude/skills/image-generation/scripts/test_forge_prop_guard.py"""
import forge

# A prop canonical (prop- prefix) is NOT a character seed -> no rig-hold.
assert forge._is_char_seed("videos/x/assets/library/prop-guidebook.png") is False, \
    "prop- seed wrongly treated as a character seed"
assert forge.should_hold("environment", ["videos/x/assets/library/prop-guidebook.png"]) is False, \
    "rig-hold wrongly appended for a prop-only seed"

# A real character library asset IS a character seed -> rig-hold holds.
assert forge._is_char_seed("videos/x/assets/library/macgregor-base.png") is True, \
    "character library asset wrongly exempted"
assert forge.should_hold("environment", ["videos/x/assets/library/macgregor-base.png"]) is True, \
    "rig-hold should append for a character seed"

# An env plate stays exempt (unchanged); a mixed prop+character seed still holds (the character needs it).
assert forge._is_char_seed("channels/c/visual-kit/refs/env/dock.png") is False
assert forge.should_hold("environment",
                         ["videos/x/assets/library/prop-guidebook.png",
                          "videos/x/assets/library/macgregor-base.png"]) is True, \
    "a scene seeding BOTH a prop and a character still needs the rig-hold for the character"

print("PASS test_forge_prop_guard")
