from pathlib import Path
import json

import pytest

from scripts.prospecting.manager.workflows import AGENT_CLI, ENTRYPOINTS, load_workflow


EXPECTED = {
    "outreach-run": ["list", "inspect-list", "personalize", "inspect-personalize", "enroll"],
    "list-only": ["list", "inspect-list"],
    "personalize-only": ["personalize", "inspect-personalize"],
    "enroll-only": ["preflight", "enroll"],
    "reply-triage": ["scan", "reconcile", "human-gate"],
}


def test_workflow_chain_and_ids() -> None:
    for name in sorted(EXPECTED):
        path = Path("workflows") / f"{name}.md"
        workflow = load_workflow(path)
        assert load_workflow(path).stages == workflow.stages
        assert workflow.id == name
        assert workflow.version == 1
        assert workflow.manager == "prospecting-manager"
        assert [stage.id for stage in workflow.stages] == EXPECTED[name]
        assert all(
            stage.agent
            in {
                "prospecting-list-builder",
                "prospecting-personalizer",
                "prospecting-campaigner",
                "inspector",
                "human",
            }
            for stage in workflow.stages
        )
        assert all(
            set(stage.__dataclass_fields__) == {"id", "agent", "operation", "needs", "inspect"}
            for stage in workflow.stages
        )


def test_inspector_follows_each_producer_in_outreach() -> None:
    stages = load_workflow(Path("workflows/outreach-run.md")).stages
    assert [(stage.id, stage.agent) for stage in stages] == [
        ("list", "prospecting-list-builder"),
        ("inspect-list", "inspector"),
        ("personalize", "prospecting-personalizer"),
        ("inspect-personalize", "inspector"),
        ("enroll", "prospecting-campaigner"),
    ]


def test_operations_are_exact_entrypoint_references() -> None:
    operations = {
        (stage.agent, stage.operation)
        for name in EXPECTED
        for stage in load_workflow(Path("workflows") / f"{name}.md").stages
    }
    producer_operations = {
        (agent, operation)
        for agent, cli in AGENT_CLI.items()
        for operation in ENTRYPOINTS[cli]["commands"]
    }
    assert operations <= producer_operations | {
        ("inspector", "grade"),
        ("human", "review"),
    }


@pytest.mark.parametrize(
    "mutation",
    [
        {"extra": True},
        {"version": 0},
        {"id": "Bad ID"},
        {
            "stages": [
                {
                    "id": "x",
                    "agent": "prospecting-campaigner",
                    "operation": "gmail_send",
                    "needs": [],
                    "inspect": False,
                }
            ]
        },
        {
            "stages": [
                {
                    "id": "x",
                    "agent": "prospecting-campaigner",
                    "operation": "sweep",
                    "needs": [],
                    "inspect": "false",
                }
            ]
        },
        {
            "stages": [
                {
                    "id": "x",
                    "agent": "prospecting-campaigner",
                    "operation": "sweep",
                    "needs": ["later"],
                    "inspect": False,
                }
            ]
        },
    ],
)
def test_invalid_workflow_shapes_fail_closed(tmp_path: Path, mutation: dict) -> None:
    base = {"id": "valid-id", "default-manager": "prospecting-manager", "version": 1, "stages": []}
    base.update(mutation)
    path = tmp_path / "bad.md"
    path.write_text("---\n" + json.dumps(base) + "\n---\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_workflow(path)
