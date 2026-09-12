"""Per-agent `mcpServers` restriction (token-discipline L4, controller ruling 1).

`.claude/agents/*.md` frontmatter is a Claude Code subagent definition — a different artifact
from kb's own `agents/*.md` routing catalog (see task-4-brief.md). Subagents inherit the parent
session's MCP servers unless their own definition sets `mcpServers` (spec §9). Builder/reviewer/
implementer-type agents that never touch browser or Gmail/Drive/video MCP tools should restrict
that field to the minimal list; any agent that plausibly browses or emails stays untouched.

This test is a manifest, not a heuristic: every `.claude/agents/*.md` file is either named in
RESTRICTED (and must carry the expected `mcpServers` value) or is asserted to have none set. A
new agent definition added later must be triaged into one bucket or the other, so the test fails
loudly instead of silently passing an unreviewed file.
"""
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[1]
AGENTS_DIR = REPO / ".claude" / "agents"

#: name -> expected `mcpServers` value.
#:
#: fyt-runner=[] verified twice (initial pass + fix-round-1 challenge that it would break the FYT
#: publish stage, since `orgs/faceless-youtube/.claude/skills/publish-queue/SKILL.md` uploads
#: through the youtube-uploader MCP). It does not: per `agents/fyt-runner.md`'s Forbidden
#: authority ("No publish: you never upload, change privacy, or touch Studio") and its Stage card
#: filing policy ("You NEVER spawn stage work as in-terminal subagents ... every review gate
#: belongs to `fyt-checker` as a filed card"), fyt-runner never executes a stage — including
#: publish-queue — inside its own session. Every stage is filed as a queue card and executed by
#: `dashboard-engine` as a separate process (`fyt-publish` for the upload), which is not governed
#: by this file's `mcpServers`. The other `mcp__` tools referenced under `orgs/faceless-youtube/`
#: (`claude-video-vision` + `claude_ai_Google_Drive`, allow-listed in
#: `orgs/faceless-youtube/.claude/settings.json`) back a separate manual research method
#: (`visual-kit/research/motion-logs/_method.md`), not a fyt-runner stage either — fyt-runner's
#: "No craft" boundary excludes it from media/review tooling. `grep -n "mcp__\|chrome-devtools\|
#: playwright\|MCP" agents/fyt-runner.md` still returns nothing.
RESTRICTED = {
    "fyt-runner": [],
}


def _frontmatter(path: Path) -> dict:
    """Parse only the opening frontmatter fence; body text is not YAML."""
    text = path.read_text(encoding="utf-8")
    assert text.startswith("---\n"), f"{path} has no frontmatter fence"
    _, frontmatter, _ = text.split("---\n", 2)
    return yaml.safe_load(frontmatter)


def _agent_files():
    if not AGENTS_DIR.is_dir():
        return []
    return sorted(AGENTS_DIR.glob("*.md"))


def test_agents_dir_has_the_expected_files():
    """Guards the RESTRICTED manifest against silent drift: a new file must be triaged."""
    found = {path.stem for path in _agent_files()}
    assert found == set(RESTRICTED), (
        f"New or removed .claude/agents/*.md file(s) detected: {found ^ set(RESTRICTED)}. "
        "Triage into RESTRICTED (never browses/emails -> minimal mcpServers) or leave "
        "untouched, then update this test."
    )


def test_restricted_agents_declare_minimal_mcp_servers():
    for name, expected in RESTRICTED.items():
        path = AGENTS_DIR / f"{name}.md"
        assert path.is_file(), f"expected agent definition missing: {path}"
        frontmatter = _frontmatter(path)
        assert "mcpServers" in frontmatter, f"{path} is missing mcpServers restriction"
        assert frontmatter["mcpServers"] == expected, (
            f"{path} mcpServers={frontmatter['mcpServers']!r}, expected {expected!r}"
        )
