"""G4 $0 dry driver — worktree-pinned, no credential, no network.

Constructs a Kit with dry=True (forge.py:327-330 -> key="", url=None: a provider call is
impossible by construction) and pins `root` via the sanctioned setter (forge.py:350-354,
whose docstring names this as THE repair for a rootless checkout such as a worktree).

Usage:
  py -3 g4_dry.py batch <shots.json> <out-spec.json> [id,id,...]
  py -3 g4_dry.py gen   <spec.json>
"""
import os
import sys

WT = r"C:\Users\danie\kb-worktrees\boss-taste-forensics"
ORG = os.path.join(WT, "orgs", "faceless-youtube")
KIT = os.path.join(ORG, "channels", "the-second-take", "visual-kit")
SCRIPTS = os.path.join(ORG, ".claude", "skills", "image-generation", "scripts")

sys.path.insert(0, SCRIPTS)
import forge  # noqa: E402


def kit():
    k = forge.Kit(KIT, dry=True)
    k.root = ORG  # sanctioned pin; clears the rootless-walk failure
    assert k.key == "" and k.url is None, "dry Kit must carry no key and no URL"
    return k


def main():
    mode = sys.argv[1]
    k = kit()
    if mode == "batch":
        shots, out = sys.argv[2], sys.argv[3]
        ids = None
        if len(sys.argv) > 4 and sys.argv[4].strip():
            ids = [i.strip() for i in sys.argv[4].split(",") if i.strip()]
        forge.cmd_batch(k, shots, out, None, ids)
    elif mode == "gen":
        import json
        reqs = json.load(open(sys.argv[2], encoding="utf-8"))
        vid = forge.video_dir_of(reqs, k.root)
        if vid and os.path.isdir(vid):
            k.use_video(vid)
        forge.cmd_gen(k, reqs, force=False, dry=True, gate=True)
    else:
        raise SystemExit("mode must be batch|gen")


if __name__ == "__main__":
    main()
