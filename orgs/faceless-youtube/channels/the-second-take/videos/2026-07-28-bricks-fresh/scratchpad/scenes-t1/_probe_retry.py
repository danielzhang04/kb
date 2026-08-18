import json, subprocess, sys

V = r"C:\Users\danie\kb-worktrees\boss-taste-forensics\orgs\faceless-youtube\channels\the-second-take\videos\2026-07-28-bricks-fresh"
VK = r"C:\Users\danie\kb-worktrees\boss-taste-forensics\orgs\faceless-youtube\channels\the-second-take\visual-kit"
FORGE = r"C:\Users\danie\kb-worktrees\boss-taste-forensics\orgs\faceless-youtube\.claude\skills\image-generation\scripts\forge.py"

overlay = json.load(open(f"{V}\\scratchpad\\scenes-t1\\retry-overlay-wA-r1.json", encoding="utf-8"))

for i, e in enumerate(overlay["entries"]):
    single = dict(overlay)
    single["entries"] = [e]
    probe_path = f"{V}\\scratchpad\\scenes-t1\\_probe_{i}.json"
    json.dump(single, open(probe_path, "w", encoding="utf-8"), indent=1)
    r = subprocess.run(
        ["py", "-3", FORGE, "batch", "--kit", VK, "--video", V,
         "--batch", f"{V}\\shots.json", "--retry", probe_path,
         "--out", f"{V}\\scratchpad\\scenes-t1\\_probe_out_{i}.json"],
        capture_output=True, text=True
    )
    print("===", i, e["shot"], "===")
    print("rc", r.returncode)
    if r.returncode:
        print(r.stderr[-800:])
    else:
        print("OK", r.stdout[-300:])
