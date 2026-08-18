import json, re, subprocess, sys, os

V = sys.argv[1]
K = sys.argv[2]
S = sys.argv[3]

with open(os.path.join(V, "shots.json"), encoding="utf-8") as f:
    d = json.load(f)
all_ids = [s["id"] for s in d["long_form"]["shots"]]

blocked = set(['L115','L118','L121','L128','L130','L139','L145','L147','L151','L152','L154','L159','L161','L181','L206','L207','L217','L225','L229','L230','L239','L246','L66','L87','L88','L90','L96','L98','L99'])

for iteration in range(30):
    scope = [i for i in all_ids if i not in blocked]
    spec_path = os.path.join(V, "scratchpad", "w2-full", "spec.json")
    log_path = os.path.join(V, "scratchpad", "w2-full", f"batch-build-iter{iteration}.log")
    cmd = ["py", "-3", os.path.join(S, "forge.py"), "--kit", K, "batch",
           "--batch", os.path.join(V, "shots.json"),
           "--shots", ",".join(scope),
           "--out", spec_path]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(r.stdout + "\n---STDERR---\n" + r.stderr)
    if r.returncode == 0 and os.path.exists(spec_path):
        print(f"CONVERGED at iteration {iteration}; blocked={sorted(blocked)}")
        print(f"scope size: {len(scope)}")
        break
    txt = r.stdout + r.stderr
    new_ids = set(re.findall(r'^(L\d+): place', txt, re.M))
    if not new_ids - blocked:
        print(f"NO PROGRESS at iteration {iteration}; remaining failure not a place-exclusion issue.")
        print(txt[-3000:])
        break
    added = new_ids - blocked
    print(f"iter {iteration}: adding {sorted(added)}")
    blocked |= new_ids
else:
    print("did not converge in 30 iterations")

print("FINAL blocked set:", sorted(blocked))
with open(os.path.join(V, "scratchpad", "w2-full", "blocked_ids.json"), "w") as f:
    json.dump(sorted(blocked), f, indent=2)
