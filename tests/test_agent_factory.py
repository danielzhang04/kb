import hashlib
from pathlib import Path

import pytest
import yaml

import cards


def _hash_tree(root: Path) -> dict:
    """Content hash of every file under ``root``, keyed by relative path."""
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


POLICY = """\
version: 1
runtimes:
  claude:
    aliases:
      sonnet: claude-sonnet-5
      opus: claude-opus-5
    known_models: [claude-sonnet-5, claude-opus-5]
  codex:
    aliases:
      codex: gpt-5.6-terra
    known_models: [gpt-5.6-terra]
policy:
  work:
    T1: { runtime: claude, model: sonnet }
  inspect:
    "*": { runtime: claude, model: opus }
role_default: { runtime: claude, model: sonnet }
"""


# Source: dashboard/server/agents/roster.ts.  Keep this list hardcoded so a
# roster field added there makes this factory contract deliberately visible.
ROSTER_FIELDS = {
    "id", "role", "runtime", "model", "tools", "knowledge-source",
    "autonomy-tier", "skills", "what-it-replaces", "builds-on",
    "default-profile", "allowed-profiles", "runner-bound", "description", "projects",
}


def _seed_policy(repo_root: Path, contents: str = POLICY) -> None:
    path = repo_root / "governance" / "model-routing.yaml"
    path.parent.mkdir(parents=True)
    path.write_text(contents, encoding="utf-8")


def _frontmatter(path: Path) -> dict:
    """Parse only the opening frontmatter fence; body fences are ordinary text."""
    text = path.read_text(encoding="utf-8")
    assert text.startswith("---\n")
    _, frontmatter, _ = text.split("---\n", 2)
    return yaml.safe_load(frontmatter)


def test_create_agent_writes_canonical_definition_memory_and_eval_suite(tmp_path):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    created = create_agent(tmp_path, "demo-agent", role="work", projects=["kb-ops"])

    assert created.definition == tmp_path / "agents" / "demo-agent.md"
    assert created.memory == tmp_path / "memory" / "demo-agent.md"
    assert created.eval_readme == tmp_path / "evals" / "agents" / "demo-agent" / "README.md"
    assert created.smoke_eval == tmp_path / "evals" / "agents" / "demo-agent" / "smoke.md"
    assert created.memory.read_text(encoding="utf-8") == "# memory: demo-agent\n"

    # A literal body fence must not be mistaken for another frontmatter delimiter.
    created.definition.write_text(
        created.definition.read_text(encoding="utf-8") + "\n---\nbody fence\n",
        encoding="utf-8",
    )
    meta = _frontmatter(created.definition)
    assert meta["id"] == "demo-agent"
    assert meta["model"] == "claude-sonnet-5"
    assert meta["kit"] is True
    assert ROSTER_FIELDS <= set(meta)
    assert meta["default-profile"] in meta["allowed-profiles"]

    smoke = _frontmatter(created.smoke_eval)
    assert set(("id", "capability", "judge", "rubric_version", "k", "source", "immutable", "tier", "input")) <= set(smoke)
    assert smoke["judge"] == "file-exists"
    assert smoke["input"] == {"path": "agents/demo-agent.md"}


def test_factory_does_not_write_a_draft_without_a_governance_need(tmp_path):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    created = create_agent(tmp_path, "ordinary-agent", role="work")

    assert created.draft is None
    assert not (tmp_path / "queue" / "drafts").exists()


def test_unknown_role_uses_role_default_and_concrete_model(tmp_path):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    created = create_agent(tmp_path, "new-role-agent", role="new-role")

    meta = _frontmatter(created.definition)
    assert meta["runtime"] == "claude"
    assert meta["model"] == "claude-sonnet-5"
    assert created.draft is None


@pytest.mark.parametrize("policy", ["not: [valid", ""])
def test_missing_or_malformed_policy_uses_concrete_safe_default(tmp_path, policy):
    from scripts.agent_factory import create_agent

    if policy:
        _seed_policy(tmp_path, policy)
    created = create_agent(tmp_path, "fallback-agent", role="new-role", runtime="unknown-runtime")

    meta = _frontmatter(created.definition)
    assert meta["runtime"] == "unknown-runtime"
    assert meta["model"] == "claude-sonnet-5"


def test_policy_runtime_is_used_when_no_explicit_runtime_is_given(tmp_path):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    created = create_agent(tmp_path, "inspect-agent", role="inspect")

    meta = _frontmatter(created.definition)
    assert meta["runtime"] == "claude"
    assert meta["model"] == "claude-opus-5"


def test_explicit_runtime_wins_over_the_policy_rows_runtime(tmp_path):
    """A --runtime pin must beat the policy row's runtime — otherwise codex
    agents are impossible to create even when a caller explicitly asks.
    Probe case: (--runtime codex --role work) -> runtime codex + a concrete
    codex model id from its alias table / known_models."""
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    created = create_agent(tmp_path, "codex-work-agent", role="work", runtime="codex")

    meta = _frontmatter(created.definition)
    assert meta["runtime"] == "codex"
    # The policy row's model ("sonnet") is a claude-vocabulary alias and does
    # not apply to codex; the concrete id must come from codex's own alias
    # table / known_models instead.
    assert meta["model"] == "gpt-5.6-terra"


def test_unknown_model_id_is_rejected(tmp_path):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    with pytest.raises(ValueError, match="not-a-real-model-9"):
        create_agent(tmp_path, "bad-model-agent", role="work", model="not-a-real-model-9")

    assert not (tmp_path / "agents" / "bad-model-agent.md").exists()


def test_create_agent_rejects_reserved_eval_suite_id(tmp_path):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    with pytest.raises(ValueError, match="reserved"):
        create_agent(tmp_path, "eval-suite", role="work")

    assert not (tmp_path / "agents" / "eval-suite.md").exists()


def test_create_agent_rejects_reserved_canary_suite_id(tmp_path):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    with pytest.raises(ValueError, match="reserved"):
        create_agent(tmp_path, "canary-suite", role="work")

    assert not (tmp_path / "agents" / "canary-suite.md").exists()


def test_explicit_model_alias_is_resolved_against_the_selected_runtime(tmp_path):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    created = create_agent(tmp_path, "explicit-alias-agent", role="inspect", model="sonnet")

    meta = _frontmatter(created.definition)
    assert meta["runtime"] == "claude"
    assert meta["model"] == "claude-sonnet-5"


def test_grader_creates_a_parseable_governance_card_without_writing_governance(tmp_path):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    created = create_agent(tmp_path, "grader-agent", role="inspect", grader=True)

    assert created.draft is not None
    draft = cards.parse(created.draft)
    assert draft.meta["owner"] == "daniel"
    assert draft.meta["state"] == "inbox"
    assert draft.meta["target"] == "governance/graders.yaml: graders entry id=grader-agent"
    assert "Add `- id: grader-agent` to `governance/graders.yaml`" in draft.body
    assert not (tmp_path / "governance" / "graders.yaml").exists()


def test_routing_override_creates_the_matching_draft(tmp_path):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    created = create_agent(tmp_path, "override-agent", role="work", needs_routing_override=True)

    assert created.draft is not None
    assert "queue/routing-override.yaml" in created.draft.read_text(encoding="utf-8")


def test_factory_refuses_an_existing_agent_id(tmp_path):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    (tmp_path / "agents").mkdir()
    (tmp_path / "agents" / "taken-agent.md").write_text("existing", encoding="utf-8")

    with pytest.raises(FileExistsError):
        create_agent(tmp_path, "taken-agent", role="work")


def test_factory_rejects_yaml_injection_in_model_before_writing(tmp_path):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    with pytest.raises(ValueError, match="unsafe model"):
        create_agent(tmp_path, "injected-agent", role="work", model="m\nrunner-bound: true")

    assert not (tmp_path / "agents" / "injected-agent.md").exists()


def test_failed_write_removes_only_factory_paths_created_by_this_run(tmp_path, monkeypatch):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    (tmp_path / "agents").mkdir()
    original_write_text = Path.write_text

    def fail_smoke_write(path, contents, *args, **kwargs):
        if path.name == "smoke.md":
            raise OSError("simulated write failure")
        return original_write_text(path, contents, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", fail_smoke_write)
    with pytest.raises(OSError, match="simulated write failure"):
        create_agent(tmp_path, "rollback-agent", role="work")

    assert (tmp_path / "agents").is_dir()  # pre-existing parent is preserved
    assert not (tmp_path / "agents" / "rollback-agent.md").exists()
    assert not (tmp_path / "memory").exists()
    assert not (tmp_path / "evals").exists()


def test_pre_existing_eval_suite_is_adopted_not_refused(tmp_path):
    """Reproduces the live defect: a hand-built evals/agents/<id>/ (as in
    commit d65f34ab) must not block `new` when the agent/memory files don't
    yet exist. The suite directory must come out byte-for-byte identical."""
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    suite_dir = tmp_path / "evals" / "agents" / "demo-agent"
    suite_dir.mkdir(parents=True)
    (suite_dir / "smoke.md").write_text("hand-built smoke eval\n", encoding="utf-8")
    (suite_dir / "MANIFEST.sha256").write_text("deadbeef  smoke.md\n", encoding="utf-8")
    before = _hash_tree(suite_dir)

    created = create_agent(tmp_path, "demo-agent", role="work")

    after = _hash_tree(suite_dir)
    assert after == before  # suite dir byte-untouched: no README written, nothing modified
    assert created.adopted_eval_suite is True
    assert created.definition.exists()
    assert created.memory.exists()
    assert created.definition.read_text(encoding="utf-8").startswith("---\nid: demo-agent\n")
    assert created.memory.read_text(encoding="utf-8") == "# memory: demo-agent\n"
    assert not (suite_dir / "README.md").exists()


def test_pre_existing_eval_suite_does_not_block_when_def_and_memory_absent_but_still_refuses_on_definition(tmp_path):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    suite_dir = tmp_path / "evals" / "agents" / "demo-agent"
    suite_dir.mkdir(parents=True)
    (tmp_path / "agents").mkdir()
    (tmp_path / "agents" / "demo-agent.md").write_text("existing definition", encoding="utf-8")

    with pytest.raises(FileExistsError):
        create_agent(tmp_path, "demo-agent", role="work")


def test_pre_existing_eval_suite_does_not_block_but_existing_memory_still_refuses(tmp_path):
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    suite_dir = tmp_path / "evals" / "agents" / "demo-agent"
    suite_dir.mkdir(parents=True)
    (tmp_path / "memory").mkdir()
    (tmp_path / "memory" / "demo-agent.md").write_text("existing memory", encoding="utf-8")

    with pytest.raises(FileExistsError):
        create_agent(tmp_path, "demo-agent", role="work")


def test_rollback_after_adoption_leaves_the_suite_intact(tmp_path, monkeypatch):
    """If a later write (e.g. memory) fails, rollback must not delete the
    adopted (pre-existing) suite directory or any file inside it."""
    from scripts.agent_factory import create_agent

    _seed_policy(tmp_path)
    suite_dir = tmp_path / "evals" / "agents" / "demo-agent"
    suite_dir.mkdir(parents=True)
    (suite_dir / "smoke.md").write_text("hand-built smoke eval\n", encoding="utf-8")
    before = _hash_tree(suite_dir)

    original_write_text = Path.write_text

    def fail_memory_write(path, contents, *args, **kwargs):
        if path.name == "demo-agent.md" and path.parent.name == "memory":
            raise OSError("simulated write failure")
        return original_write_text(path, contents, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", fail_memory_write)
    with pytest.raises(OSError, match="simulated write failure"):
        create_agent(tmp_path, "demo-agent", role="work")

    assert suite_dir.is_dir()
    assert _hash_tree(suite_dir) == before  # adopted suite untouched by rollback
    assert not (tmp_path / "agents" / "demo-agent.md").exists()
    assert not (tmp_path / "memory").exists()
