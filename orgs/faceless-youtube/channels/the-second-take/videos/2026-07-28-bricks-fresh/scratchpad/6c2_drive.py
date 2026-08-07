"""Transport-resilient driver for one 6c2 wave.

The provider (`gemini-3-pro-image`) is intermittently returning HTTP 503 "experiencing high
demand". A 503 returns no image and is billed nothing, so it is a TRANSPORT failure, not the
content failure the one-retry law governs. This driver re-issues ONLY the items that have no
frame on disk, pass after pass, and stops on a pass that produced nothing (the provider is
genuinely down) or when everything is minted.

Usage: py -3 6c2_drive.py <wave-spec.json> <log-prefix> [max_passes]
"""
import json
import os
import subprocess
import sys
import time

KIT = "C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit"
STAGING = KIT + "/_staging/"
FORGE = "C:/Users/danie/kb/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py"
HERE = os.path.dirname(os.path.abspath(__file__))


def missing(items):
    return [i for i in items if not os.path.exists(STAGING + i["name"] + ".png")]


def main():
    spec_path, prefix = sys.argv[1], sys.argv[2]
    max_passes = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    items = json.load(open(spec_path, encoding="utf-8"))
    for p in range(1, max_passes + 1):
        todo = missing(items)
        if not todo:
            print("ALL MINTED after %d pass(es)" % (p - 1), flush=True)
            return 0
        spec = os.path.join(HERE, "%s-pass%d.json" % (prefix, p))
        log = os.path.join(HERE, "%s-pass%d.log" % (prefix, p))
        json.dump(todo, open(spec, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        print("PASS %d: %d item(s) to mint" % (p, len(todo)), flush=True)
        with open(log, "w", encoding="utf-8") as fh:
            subprocess.run([sys.executable, FORGE, "gen", "--kit", KIT, "--batch", spec],
                           stdout=fh, stderr=subprocess.STDOUT)
        after = missing(items)
        gained = len(todo) - len(after)
        print("PASS %d: +%d minted, %d still missing" % (p, gained, len(after)), flush=True)
        if not after:
            print("ALL MINTED after %d pass(es)" % p, flush=True)
            return 0
        if gained == 0:
            print("PASS %d produced NOTHING — provider is down; stopping" % p, flush=True)
            return 1
        time.sleep(20)
    print("MAX PASSES reached; %d still missing" % len(missing(items)), flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())
