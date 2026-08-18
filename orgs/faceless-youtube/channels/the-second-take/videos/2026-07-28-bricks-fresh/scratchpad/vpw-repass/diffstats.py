import json, re

with open("videos/2026-07-28-bricks-fresh/shots.json", encoding="utf-8") as f:
    new = json.load(f)
with open(
    "C:/Users/danie/AppData/Local/Temp/claude/C--Users-danie-kb/"
    "1cd9c89c-cfb7-46ed-9e64-824ddef0603c/scratchpad/orig_shots.json",
    encoding="utf-8",
) as f:
    orig = json.load(f)

ACT1 = {f"L{n:02d}" for n in range(1, 28)}
ACT1_17 = {f"L{n:02d}" for n in range(1, 18)}


def act1(d):
    return [s for s in d["long_form"]["shots"] if s["id"] in ACT1]


o = act1(orig)
n = act1(new)


def stages(shots):
    st = {}
    for s in shots:
        if s.get("stage"):
            st.setdefault(s["stage"], []).append(s["id"])
    return st


print("=== stages/chains (L01-L27) ===")
print("before:", stages(o))
print("after:", stages(n))

PCB = "`pc-boxy`"


def pc_boxy_count(shots, ids=None):
    return sum(
        1
        for s in shots
        if (ids is None or s["id"] in ids) and PCB in s.get("still_prompt", "")
    )


print()
print("personified pc-boxy count (L01-L27) before/after:", pc_boxy_count(o), pc_boxy_count(n))
print(
    "personified pc-boxy count (L01-L17) before/after:",
    pc_boxy_count(o, ACT1_17),
    pc_boxy_count(n, ACT1_17),
)


def word_count(shots, word):
    return sum(len(re.findall(word, s.get("still_prompt", ""), re.I)) for s in shots)


for w in ["teal", "charcoal", "grey", "gray"]:
    print(f"{w} count before/after:", word_count(o, w), word_count(n, w))

# vantage wording distinctness heuristic
VANTAGE_TERMS = [
    "eye-level", "planted centre", "frontal", "low angle", "seen low",
    "seen from a low", "seen from a high", "high vantage", "high oblique",
    "receding oblique", "three-quarter angle", "from the foot of the bed",
    "just behind the plinth", "along the counter surface", "ringside",
    "loading dock", "behind the drift", "from slightly above",
]


def vantage_signature(prompt):
    p = prompt.lower()
    hits = [t for t in VANTAGE_TERMS if t in p]
    return tuple(hits) if hits else ("unmarked/default",)


print()
print("=== vantage signatures (after) ===")
sigs = {}
for s in n:
    sigs[s["id"]] = vantage_signature(s.get("still_prompt", ""))
for sid, sig in sigs.items():
    print(sid, sig)
distinct = set(sigs.values())
print("distinct vantage signatures:", len(distinct), "across", len(sigs), "shots")

print()
print("=== vantage signatures (before) ===")
sigs_o = {}
for s in o:
    sigs_o[s["id"]] = vantage_signature(s.get("still_prompt", ""))
distinct_o = set(sigs_o.values())
print("distinct vantage signatures:", len(distinct_o), "across", len(sigs_o), "shots")
unmarked_before = sum(1 for v in sigs_o.values() if v == ("unmarked/default",))
unmarked_after = sum(1 for v in sigs.values() if v == ("unmarked/default",))
print("shots with no explicit non-default vantage marker before/after:", unmarked_before, unmarked_after)
