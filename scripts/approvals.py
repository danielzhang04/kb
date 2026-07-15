"""Human-only approval verification (spec s7).

verdict() is pure logic (tested); approved_by_human() wires it to git + files.
v1 limitation: local git author is advisory; GitHub branch protection on the
approvals path is the enforced gate. Belt and suspenders.
"""
from __future__ import annotations

import datetime
import hashlib
import subprocess
from pathlib import Path

import yaml

import cards

MAX_AGE = datetime.timedelta(hours=24)


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def work_order_of(body: str) -> str:
    """Extract the first top-level '## Work order' section, fence-aware.

    Rules: a ``` at column 0 toggles fenced-code state; fenced lines are never
    headings. Only column-0 '## ' lines outside fences are headings (no strip).
    Capture only the FIRST '## Work order' section — from the line after the
    exact heading to the next column-0 unfenced '## ' heading (or EOF). Later
    occurrences do not re-arm. Absent heading raises ValueError.
    """
    lines: list[str] = []
    capture = False
    fenced = False
    found = False
    done = False
    for line in body.splitlines():
        if line.startswith("```"):
            fenced = not fenced
            if capture:
                lines.append(line)
            continue
        is_heading = (not fenced) and line.startswith("## ")
        if is_heading:
            if capture:            # next heading ends the first section
                capture = False
                done = True
            elif not done and line == "## Work order":
                capture = True
                found = True
            continue
        if capture:
            lines.append(line)
    if not found:
        raise ValueError("no '## Work order' section")
    return "\n".join(lines).strip()


def verdict(state, author, humans, approval_field, work_order_hash,
            commit_age) -> tuple[bool, str]:
    if state != "approved":
        return False, f"card state is '{state}', not 'approved'"
    if author not in humans:
        return False, f"approver '{author}' is not a listed human"
    if approval_field != work_order_hash:
        return False, "approval hash does not match work order (content changed after approval?)"
    if commit_age < datetime.timedelta(0):
        return False, "approval author date is in the future (clock skew or forgery?)"
    if commit_age > MAX_AGE:
        return False, f"approval is stale (> {MAX_AGE})"
    return True, "ok"


def approved_by_human(card_path: Path, repo_root: Path) -> tuple[bool, str]:
    card = cards.parse(card_path)
    humans_file = Path(repo_root) / "governance" / "humans.yaml"
    humans = (yaml.safe_load(humans_file.read_text(encoding="utf-8")) or {}).get("humans", [])
    try:
        wo_hash = content_hash(work_order_of(card.body))
    except ValueError:
        return False, "card has no work order section"

    # Bind the approver to the commit that INTRODUCED the approval value, not
    # the last commit touching the file. A falsy approval can't be laundered
    # into acceptance by a later unrelated human commit, so reject it early.
    approval = card.meta.get("approval")
    if not approval:
        return False, "card has no approval value"
    rel = str(Path(card_path).relative_to(repo_root)).replace("\\", "/")
    out = subprocess.run(
        ["git", "log", "-1", "--format=%an%n%aI", f"-S{approval}",
         "--", f":(literal){rel}"],
        cwd=repo_root, capture_output=True, text=True, check=True).stdout.strip().splitlines()
    if len(out) < 2:
        return False, "no commit set the approval value"
    author, iso = out[0], out[1]
    age = datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(iso)
    return verdict(card.meta["state"], author, humans,
                   approval, wo_hash, age)
