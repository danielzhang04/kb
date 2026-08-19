"""Create the standard declaration, lesson shard, and eval scaffold for one agent."""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

# Support both ``py scripts/agent_factory.py`` and ``py -m scripts.agent_factory``.
SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import cards  # noqa: E402
from routing import SAFE_DEFAULT, _known_models, _policy_entry, _resolve_alias, load_policy  # noqa: E402

# Reserved ledger worker identities — never a creatable agent id (grades under
# these names have a fixed, code-relied-upon meaning; see promotion.status()'s
# (worker, project, task_type, tier) key). Imported rather than hardcoded so a
# rename at the source is deliberately visible here.
from agent_evals import EVAL_WORKER  # noqa: E402  (scripts/agent_evals.py:43)
from canary import CANARY_WORKER  # noqa: E402  (scripts/canary.py:48)

RESERVED_AGENT_IDS = frozenset({EVAL_WORKER, CANARY_WORKER})

SAFE_AGENT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
SAFE_VALUE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
DEFAULT_TIER = "T1"


@dataclass(frozen=True)
class CreatedAgent:
    """The paths created by one factory invocation.

    ``eval_readme``/``smoke_eval`` are the suite's canonical paths regardless
    of adoption; when ``adopted_eval_suite`` is True neither was written by
    this run (a pre-existing ``evals/agents/<id>/`` was adopted verbatim).
    """

    definition: Path
    memory: Path
    eval_readme: Path
    smoke_eval: Path
    draft: Path | None
    adopted_eval_suite: bool = False


def _validate_value(field: str, value: str) -> str:
    if not isinstance(value, str) or not SAFE_VALUE.fullmatch(value):
        raise ValueError(f"unsafe {field}: {value!r}")
    return value


def _default_route(repo_root: Path, role: str, runtime: str | None) -> tuple[str, str, dict]:
    """Return the resolved runtime and a concrete default model id.

    ``runtime`` is the CALLER's explicit ``--runtime`` value, or ``None`` when
    the caller did not pass one. An explicit runtime always WINS over the
    policy row's runtime (explicit beats default) — otherwise the policy
    row's runtime is used, falling back to ``SAFE_DEFAULT``'s runtime.

    When an explicit runtime conflicts with the policy row's own runtime, the
    policy row's ``model`` is a tier alias in the POLICY runtime's vocabulary
    (e.g. claude's ``sonnet``) and does not apply to a different runtime, so
    it is not used; instead the explicit runtime's own same-named alias is
    tried (governance/model-routing.yaml documents this convention, e.g.
    ``runtimes.codex.aliases.codex`` is commented "dispatch default").
    """
    policy = load_policy(repo_root)
    matrix = policy.get("policy") or {}
    if not isinstance(matrix.get(role), dict):
        print(
            f"warning: role '{role}' has no routing policy row — agent will be "
            "execution-ineligible in the roster until a role/override exists",
            file=sys.stderr,
        )
    entry = _policy_entry(policy, role, DEFAULT_TIER) or {}
    policy_runtime = entry.get("runtime")
    explicit = runtime is not None
    selected_runtime = runtime if explicit else str(policy_runtime or SAFE_DEFAULT[0])

    conflict = explicit and policy_runtime and str(policy_runtime) != selected_runtime
    if conflict:
        model_or_alias = selected_runtime
    else:
        model_or_alias = str(entry.get("model") or SAFE_DEFAULT[1])
    return selected_runtime, str(_resolve_alias(policy, selected_runtime, model_or_alias)), policy


def _validate_known_model(policy: dict, runtime: str, model: str) -> None:
    """Fail loud on a resolved model id the runtime does not know about."""
    known = _known_models(policy, runtime)
    if known is not None and model not in known:
        raise ValueError(
            f"model {model!r} is not a known model for runtime {runtime!r}; "
            f"valid ids: {known!r}"
        )


def _profile_role(role: str) -> str:
    return "manager" if role in {"manage", "manager"} else "worker"


def _agent_definition(agent_id: str, role: str, runtime: str, model: str, projects: list[str]) -> str:
    profile = f"{_profile_role(role)}:{runtime}:{model}"
    project_text = ", ".join(projects)
    return f"""---
id: {agent_id}
role: {role}
runtime: {runtime}
model: {model}
default-profile: {profile}
allowed-profiles: [{profile}]
projects: [{project_text}]
runner-bound: false
description: Factory-created {role} agent.
tools: []
knowledge-source: []
autonomy-tier: queues-for-me
skills: []
what-it-replaces: null
builds-on: []
kit: true  # advisory — kit delivery is unconditional at dispatch (codex prepend; U9 when armed)
---

# {agent_id}

This agent uses the shared kit; its task-specific instructions belong in its work orders.
"""


def _smoke_eval(agent_id: str) -> str:
    return f"""---
id: {agent_id}-smoke
capability: {agent_id}-smoke
judge: file-exists
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  path: agents/{agent_id}.md
---

# {agent_id} smoke eval

Confirms that the agent declaration created by the factory exists.
"""


def _draft(agent_id: str, *, grader: bool, needs_routing_override: bool) -> str:
    targets: list[str] = []
    work: list[str] = []
    if grader:
        targets.append(f"governance/graders.yaml: graders entry id={agent_id}")
        work.append(f"Add `- id: {agent_id}` to `governance/graders.yaml` under `graders`.")
    if needs_routing_override:
        targets.append(f"queue/routing-override.yaml: override entry for {agent_id}")
        work.append(f"Add the reviewed routing override entry for `{agent_id}` to `queue/routing-override.yaml`.")
    target = "; ".join(targets)
    body = "## Work order\n\n" + "\n".join(work) + (
        "\n\nHuman review and publication are required. This draft is not active while it remains "
        "under `queue/drafts/`.\n"
    )
    card = cards.new_card(
        "kb-ops", "publish agent governance configuration", target, "T1", body,
        owner="daniel",
    )
    frontmatter = yaml.safe_dump(card.meta, sort_keys=False, allow_unicode=True)
    return f"---\n{frontmatter}---\n\n{card.body}"


def _mkdir(path: Path, created_directories: list[Path]) -> None:
    """Create ``path`` and record only directories this invocation made."""
    missing: list[Path] = []
    current = path
    while not current.exists():
        missing.append(current)
        current = current.parent
    for directory in reversed(missing):
        directory.mkdir()
        created_directories.append(directory)


def _rollback(created_files: list[Path], created_directories: list[Path]) -> None:
    for path in reversed(created_files):
        if path.exists():
            path.unlink()
    for directory in reversed(created_directories):
        try:
            directory.rmdir()
        except OSError:
            pass


def create_agent(
    repo_root: Path,
    agent_id: str,
    *,
    role: str,
    runtime: str | None = None,
    model: str | None = None,
    projects: list[str] | None = None,
    grader: bool = False,
    needs_routing_override: bool = False,
) -> CreatedAgent:
    """Create one agent's files, refusing to overwrite any pre-existing scaffold.

    ``runtime=None`` means the caller did not pass an explicit ``--runtime``
    (the policy row decides); a concrete value always wins over policy.
    """
    if not SAFE_AGENT_ID.fullmatch(agent_id):
        raise ValueError(f"unsafe agent id: {agent_id!r}")
    if agent_id in RESERVED_AGENT_IDS:
        raise ValueError(
            f"agent id {agent_id!r} is reserved for a ledger worker identity "
            f"(scripts/agent_evals.py EVAL_WORKER / scripts/canary.py CANARY_WORKER) "
            "and cannot be created"
        )
    _validate_value("role", role)
    if runtime is not None:
        _validate_value("runtime", runtime)
    if model is not None:
        _validate_value("model", model)
    project_list = list(projects or [])
    for project in project_list:
        _validate_value("project", project)

    root = Path(repo_root)
    selected_runtime, default_model, policy = _default_route(root, role, runtime)
    chosen_model = (
        str(_resolve_alias(policy, selected_runtime, model))
        if model is not None else default_model
    )
    _validate_known_model(policy, selected_runtime, chosen_model)

    definition = root / "agents" / f"{agent_id}.md"
    memory = root / "memory" / f"{agent_id}.md"
    eval_dir = root / "evals" / "agents" / agent_id
    eval_readme = eval_dir / "README.md"
    smoke_eval = eval_dir / "smoke.md"
    draft = (root / "queue" / "drafts" / f"{agent_id}-governance.md"
             if grader or needs_routing_override else None)
    # Only agents/<id>.md and memory/<id>.md gate creation. A pre-existing
    # evals/agents/<id>/ (e.g. hand-built ahead of the factory, see
    # commit d65f34ab) is ADOPTED below rather than refused: the factory
    # never overwrites or supplements a suite it did not create.
    targets = [definition, memory]
    if draft is not None:
        targets.append(draft)
    existing = next((path for path in targets if path.exists()), None)
    if existing is not None:
        raise FileExistsError(existing)

    adopted_eval_suite = eval_dir.exists()

    created_files: list[Path] = []
    created_directories: list[Path] = []
    try:
        _mkdir(definition.parent, created_directories)
        _mkdir(memory.parent, created_directories)
        write_targets = [
            (definition, _agent_definition(agent_id, role, selected_runtime, chosen_model, project_list)),
            (memory, f"# memory: {agent_id}\n"),
        ]
        if not adopted_eval_suite:
            _mkdir(eval_dir, created_directories)
            write_targets.append(
                (eval_readme, f"# {agent_id} eval suite\n\nFactory scaffold; human promotion is required before use as a golden suite.\n")
            )
            write_targets.append((smoke_eval, _smoke_eval(agent_id)))
        if draft is not None:
            _mkdir(draft.parent, created_directories)

        for path, contents in write_targets:
            created_files.append(path)
            path.write_text(contents, encoding="utf-8")
        if draft is not None:
            created_files.append(draft)
            draft.write_text(
                _draft(agent_id, grader=grader, needs_routing_override=needs_routing_override),
                encoding="utf-8",
            )
    except Exception:
        _rollback(created_files, created_directories)
        raise

    return CreatedAgent(definition, memory, eval_readme, smoke_eval, draft, adopted_eval_suite)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    new = subparsers.add_parser("new", help="create an agent scaffold")
    new.add_argument("agent_id")
    new.add_argument("--role", required=True)
    new.add_argument("--runtime", default=None, help="explicit runtime; wins over the policy row's runtime")
    new.add_argument("--model")
    new.add_argument("--project", dest="projects", action="append")
    new.add_argument("--grader", action="store_true")
    new.add_argument("--needs-routing-override", action="store_true")
    args = parser.parse_args()

    created = create_agent(
        Path.cwd(), args.agent_id, role=args.role, runtime=args.runtime, model=args.model,
        projects=args.projects, grader=args.grader, needs_routing_override=args.needs_routing_override,
    )
    for path in (created.definition, created.memory, created.draft):
        if path is not None:
            print(path)
    if created.adopted_eval_suite:
        print(f"adopted existing eval suite: evals/agents/{args.agent_id}/")
    else:
        print(created.eval_readme)
        print(created.smoke_eval)
    if created.draft is not None:
        print(f"Publish this draft verbatim to ops after human review: {created.draft}")
    print(
        "Eval suite is dead until human blessing: "
        f"py -3 -m scripts.agent_evals run {args.agent_id} --update-manifest"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
