"""Tests for orgs/figment/HEARTBEAT.md — the seven bounded, unarmed P4f cadences.

Scope: this task (P4f) creates exactly `orgs/figment/HEARTBEAT.md` and this test file.
The dashboard's own heartbeat parser (`dashboard/server/schedules/heartbeat.ts`) is a
separate, more permissive scalar-only reader; this test independently parses the same
YAML fence with PyYAML so the fixture is checked against the plan's exact schema
(including `armed` and `agent`, which the TS reader does not need).
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

HEARTBEAT = Path(__file__).resolve().parents[1] / "HEARTBEAT.md"

REQUIRED_KEYS = {"name", "schedule", "tier", "agent", "armed", "risk-tier", "prompt"}

# Task 4 §4.1 cadence inventory, in table order.
EXPECTED_ROWS = [
    {"name": "figment-cohort-scan", "schedule": "weekly", "risk-tier": "T3",
     "tier": "desktop", "agent": "figment-researcher"},
    {"name": "figment-platform-trends", "schedule": "weekly", "risk-tier": "T1",
     "tier": "cloud", "agent": "figment-researcher"},
    {"name": "figment-tooling-watch", "schedule": "fortnightly", "risk-tier": "T1",
     "tier": "cloud", "agent": "figment-researcher"},
    {"name": "figment-fanvue-economics", "schedule": "monthly", "risk-tier": "T1",
     "tier": "cloud", "agent": "figment-researcher"},
    {"name": "figment-insights-pull", "schedule": "daily", "risk-tier": "T2",
     "tier": "desktop", "agent": "figment-analyst"},
    {"name": "figment-token-health", "schedule": "daily", "risk-tier": "T2",
     "tier": "desktop", "agent": "figment-analyst"},
    {"name": "figment-optimise", "schedule": "weekly", "risk-tier": "T1",
     "tier": "desktop", "agent": "figment-analyst"},
]


def load_heartbeat(path: Path) -> dict:
    """Parse the first ```yaml fence in a HEARTBEAT.md file with a real YAML loader."""
    text = path.read_text(encoding="utf-8")
    match = re.search(r"```ya?ml\s*\r?\n(.*?)```", text, re.S)
    assert match, f"{path}: no terminated YAML fence found"
    data = yaml.safe_load(match.group(1))
    assert isinstance(data, dict) and isinstance(data.get("cadences"), list), (
        f"{path}: fence did not parse to a mapping with a 'cadences' list"
    )
    return data


def inventory(heartbeat: dict) -> list[dict]:
    return [
        {
            "name": c["name"],
            "schedule": c["schedule"],
            "risk-tier": c["risk-tier"],
            "tier": c["tier"],
            "agent": c["agent"],
        }
        for c in heartbeat["cadences"]
    ]


def by_name(heartbeat: dict, name: str) -> dict:
    for cadence in heartbeat["cadences"]:
        if cadence["name"] == name:
            return cadence
    raise KeyError(name)


def _flatten(prompt: str) -> str:
    """Collapse the YAML block scalar's hard line-wraps to single spaces so a
    multi-word phrase check does not depend on where the prose happens to wrap."""
    return re.sub(r"\s+", " ", prompt.lower()).strip()


def assert_prompt_is_bounded_idempotent_and_has_noop(prompt: str) -> None:
    lowered = _flatten(prompt)
    # Bounded: a single retry, then a human wake, never a silent/infinite retry loop.
    assert "retry once" in lowered, "prompt must bound retries to exactly one"
    assert "wake" in lowered and "stop" in lowered, "prompt must wake a human and stop"
    # Idempotent: reruns dedupe against already-recorded rows by schedule key.
    assert "dedup" in lowered or "idempotent" in lowered, "prompt must declare dedupe/idempotency"
    # Decidable no-op path: the loop can legitimately produce "nothing changed".
    assert (
        "no-change" in lowered or "no change" in lowered or "evidence unavailable" in lowered
    ), "prompt must name an explicit no-op/no-change result"


def assert_prompt_forbids_social_actions(prompt: str) -> None:
    lowered = _flatten(prompt)
    for forbidden in ("no login", "no interaction", "no download", "story", "first grid page"):
        assert forbidden in lowered, f"cohort-scan prompt missing bound: {forbidden!r}"


def test_cadence_inventory_matches_plan_table():
    heartbeat = load_heartbeat(HEARTBEAT)
    assert inventory(heartbeat) == EXPECTED_ROWS
    assert all(c["armed"] is False for c in heartbeat["cadences"])


def test_every_cadence_is_bounded_decidable_and_idempotent():
    for cadence in (data := load_heartbeat(HEARTBEAT))["cadences"]:
        assert set(cadence) == REQUIRED_KEYS
        assert_prompt_is_bounded_idempotent_and_has_noop(cadence["prompt"])
    assert_prompt_forbids_social_actions(by_name(data, "figment-cohort-scan")["prompt"])
    assert "proposes only" in by_name(data, "figment-optimise")["prompt"]


def test_cohort_scan_is_authenticated_and_single_task_per_run():
    prompt = _flatten(by_name(load_heartbeat(HEARTBEAT), "figment-cohort-scan")["prompt"])
    assert "one operator-approved task per run" in prompt
    assert "own tab" in prompt


def test_platform_trends_avoids_the_recommendation_surfaces():
    prompt = _flatten(by_name(load_heartbeat(HEARTBEAT), "figment-platform-trends")["prompt"])
    assert "no follows" in prompt
    assert "explore" in prompt and "reels" in prompt


def test_fanvue_economics_forbids_spend_and_engagement():
    prompt = _flatten(by_name(load_heartbeat(HEARTBEAT), "figment-fanvue-economics")["prompt"])
    for forbidden in ("no follows", "no engagement", "zero spend", "no payment", "no messaging"):
        assert forbidden in prompt, f"fanvue-economics prompt missing bound: {forbidden!r}"


def test_insights_pull_retains_raw_response_and_waits_before_grading():
    prompt = _flatten(by_name(load_heartbeat(HEARTBEAT), "figment-insights-pull")["prompt"])
    assert "raw response" in prompt
    assert "+48" in prompt or "48h" in prompt or "48 h" in prompt


def test_token_health_never_touches_the_token_value():
    prompt = _flatten(by_name(load_heartbeat(HEARTBEAT), "figment-token-health")["prompt"])
    assert "never reads or writes a token" in prompt


def test_optimise_reads_warehouse_only_and_never_applies_its_own_proposal():
    prompt = _flatten(by_name(load_heartbeat(HEARTBEAT), "figment-optimise")["prompt"])
    assert "warehouse" in prompt
    assert "proposes only" in prompt


def test_no_banned_look_spec_phrase_appears_in_any_prompt():
    # look-spec-v2.md §4a's banned families (soft-glam, bronzer/contour, plastic-skin,
    # lip, brow/lash, styling-signature, body, light, and the age-minor family). None of
    # these are image-generation prompts, but the build brief requires every prompt or
    # template this task writes to clear the same banned-term list.
    banned = {
        "soft glam", "glam", "glamorous", "beauty shot", "professional makeup",
        "makeup artist", "full face of makeup", "beat", "snatched", "editorial",
        "high fashion", "vogue", "striking", "sultry", "smouldering", "seductive",
        "alluring", "bronzer", "bronzed", "luminous bronzer", "sun-kissed", "gilded",
        "contour", "contoured", "sculpted cheekbones", "chiselled", "defined jawline",
        "highlighter", "strobing", "cut crease", "baked", "bake-and-brush",
        "flawless skin", "poreless", "airbrushed", "porcelain skin", "glass skin",
        "glowing", "radiant", "luminous", "dewy glow", "filtered", "retouched",
        "perfect complexion", "glossy nude lip", "full lips", "plump lips",
        "pouty lips", "plush lips", "overlined", "lip filler", "groomed full brow",
        "perfectly arched brows", "laminated brows", "bold brows", "dramatic lashes",
        "lash extensions", "winged eyeliner", "smoky eye", "gold hoops",
        "gold hoop earrings", "statement jewelry", "layered gold", "caramel balayage",
        "honey balayage", "money piece", "blowout", "salon hair", "hourglass",
        "curvaceous", "voluptuous", "busty", "tiny waist", "snatched waist",
        "studio lighting", "beauty lighting", "softbox", "ring light",
        "seamless backdrop", "golden hour glow", "cinematic lighting",
        "professional photography", "girl", "young girl", "teen", "teenage",
        "schoolgirl", "high school", "barely legal", "youthful", "baby face",
        "babyface", "childlike", "innocent", "doll-like", "petite little",
        "cute little", "tiny body", "pigtails", "uniform",
    }
    data = load_heartbeat(HEARTBEAT)
    for cadence in data["cadences"]:
        lowered = _flatten(cadence["prompt"])
        hit = [term for term in banned if term in lowered]
        assert not hit, f"{cadence['name']}: banned look-spec-v2 §4a term(s) {hit}"
