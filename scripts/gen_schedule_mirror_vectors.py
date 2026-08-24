"""Regenerate tests/fixtures/dashboard-v3-p4-mirror-vectors.json from the live renderer."""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
real = open(os.path.join(ROOT, "HEARTBEAT.md"), encoding="utf-8", newline="").read()
small = (
    "# Org\r\n"
    "\r\n"
    "```yaml\r\n"
    "cadences:\r\n"
    "  - name: alpha\r\n"
    "    schedule: daily\r\n"
    "    tier: desktop\r\n"
    "    agent: alpha-agent\r\n"
    "    risk-tier: T1\r\n"
    "    prompt: |\r\n"
    "      do the thing\r\n"
    "      schedule: not-a-field\r\n"
    "  - name: beta\r\n"
    "    schedule: weekly:sat\r\n"
    "    tier: desktop\r\n"
    "    agent: beta-agent\r\n"
    "    armed: false\r\n"
    "    risk-tier: T2\r\n"
    "    prompt: |\r\n"
    "      other thing\r\n"
    "```\r\n"
)
lf_small = small.replace("\r\n", "\n")

cases = [
    {
        "name": "real-heartbeat-field-level-update",
        "note": "the real HEARTBEAT.md (CRLF on disk): two rows updated in place, one non-seed row and one unmatched row skipped",
        "path": "HEARTBEAT.md",
        "input": real,
        "rows": [
            {"id": "a" * 64, "name": "nightly-review", "schedule": "daily", "agent": "dispatcher-cloud", "armed": True},
            {"id": "b" * 64, "name": "system-sweeper", "schedule": "*/30 * * * *", "agent": "system-sweeper", "armed": False},
            {"id": "c" * 64, "name": None, "schedule": "daily", "agent": "ops", "armed": True},
            {"id": "d" * 64, "name": "ghost-cadence", "schedule": "daily", "agent": "ops", "armed": True},
        ],
    },
    {
        "name": "org-mirror-insert-and-flip-crlf",
        "note": "armed inserted after schedule for alpha; beta keeps its byte-identical schedule and flips armed + agent, CRLF preserved",
        "path": "orgs/faceless-youtube/HEARTBEAT.md",
        "input": small,
        "rows": [
            {"id": "1" * 64, "name": "alpha", "schedule": "15 4 * * *", "agent": "alpha-agent", "armed": True},
            {"id": "2" * 64, "name": "beta", "schedule": "weekly:sat", "agent": "beta-renamed", "armed": True},
        ],
    },
    {
        "name": "org-mirror-insert-and-flip-lf",
        "note": "the same edit on an LF file: the mirror emits the terminator the file already uses",
        "path": "orgs/faceless-youtube/HEARTBEAT.md",
        "input": lf_small,
        "rows": [
            {"id": "1" * 64, "name": "alpha", "schedule": "15 4 * * *", "agent": "alpha-agent", "armed": True},
            {"id": "2" * 64, "name": "beta", "schedule": "weekly:sat", "agent": "beta-renamed", "armed": True},
        ],
    },
    {
        "name": "no-change-is-byte-identical",
        "note": "a row already in sync renders the file byte-for-byte unchanged",
        "path": "HEARTBEAT.md",
        "input": real,
        "rows": [
            {"id": "3" * 64, "name": "context-lifecycle", "schedule": "15 1 * * *", "agent": "context-lifecycle", "armed": True},
        ],
    },
    {
        "name": "over-bound-and-unsafe-fields-skip-the-row",
        "note": "an over-long schedule and an escape-hazard value each lose their row, never the batch",
        "path": "orgs/faceless-youtube/HEARTBEAT.md",
        "input": small,
        "rows": [
            {"id": "4" * 64, "name": "alpha", "schedule": "x" * 201, "agent": "alpha-agent", "armed": True},
            {"id": "5" * 64, "name": "beta", "schedule": "daily `echo pwned`", "agent": "beta-agent", "armed": True},
        ],
    },
]

out = []
for case in cases:
    payload = json.dumps({"paths": [{"path": case["path"], "bytes": case["input"], "rows": case["rows"]}]})
    process = subprocess.run(
        [sys.executable, os.path.join(ROOT, "scripts", "schedule_mirror.py"), "--render"],
        input=payload, capture_output=True, text=True, encoding="utf-8",
    )
    decoded = json.loads(process.stdout)
    assert decoded["ok"], (case["name"], decoded)
    rendered = decoded["paths"][0]
    out.append({**case, "expected": {
        "content": rendered["content"], "digest": rendered["digest"],
        "changed": rendered["changed"], "skipped": rendered["skipped"],
    }})

document = {
    "schema": "kb.dashboard-v3.p4.schedule-mirror-vectors/v1",
    "note": "Shared renderer vectors. tests/test_schedule_mirror.py and dashboard/server/schedules/mirror.test.ts BOTH consume this file; a one-sided change to the row fields or the render rules fails one of them. Regenerate with scripts/_gen_mirror_vectors.py.",
    "rowFields": ["id", "name", "schedule", "agent", "armed"],
    "cases": out,
}
target = os.path.join(ROOT, "tests", "fixtures", "dashboard-v3-p4-mirror-vectors.json")
os.makedirs(os.path.dirname(target), exist_ok=True)
with open(target, "w", encoding="utf-8", newline="\n") as handle:
    handle.write(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
for case in out:
    print(case["name"], "changed=", case["expected"]["changed"],
          "skipped=", [entry["reason"] for entry in case["expected"]["skipped"]])
