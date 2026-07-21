from types import SimpleNamespace
from worker.fastlane import answer, TOOLS

def fake_client(scripted):
    calls = []
    def create(**kw):
        calls.append(kw)
        return scripted.pop(0)
    c = SimpleNamespace(messages=SimpleNamespace(create=create))
    c.calls = calls
    return c

def block(**kw):
    return SimpleNamespace(**kw)

def test_answer_runs_tool_loop(kb_fixture, monkeypatch):
    monkeypatch.setenv("ATLAS_KB_ROOT", str(kb_fixture))
    fake = fake_client([
        SimpleNamespace(stop_reason="tool_use",
                        content=[block(type="tool_use", name="queue_summary", input={}, id="tu_1")]),
        SimpleNamespace(stop_reason="end_turn",
                        content=[block(type="text", text="One card in inbox.")]),
    ])
    out = answer("what's queued?", client=fake, model="claude-haiku-4-5")
    assert out == "One card in inbox."
    assert any(t["name"] == "queue_summary" for t in fake.calls[0]["tools"])

def test_tool_names_cover_surface():
    # V0 read tools + the Task-9 voice tools (file_card / launch_workflow / credit_remaining).
    assert {t["name"] for t in TOOLS} == {
        "queue_summary", "read_dashboard", "read_state", "ledger_rollup", "running_work",
        "file_card", "launch_workflow", "credit_remaining"}


def test_load_persona_reads_file_and_falls_back(tmp_path):
    # Task 12: persona.md is the source of truth; missing/empty file -> V0 fallback text.
    from worker.fastlane import load_persona, _FALLBACK_PERSONA, _PERSONA_PATH
    p = tmp_path / "persona.md"
    p.write_text("You are Atlas. Be brief.\n", encoding="utf-8")
    assert load_persona(p) == "You are Atlas. Be brief."
    assert load_persona(tmp_path / "missing.md") == _FALLBACK_PERSONA
    empty = tmp_path / "empty.md"
    empty.write_text("   \n", encoding="utf-8")
    assert load_persona(empty) == _FALLBACK_PERSONA
    # the shipped file exists and is what SYSTEM was built from at import time
    assert _PERSONA_PATH.is_file()


def test_shipped_persona_keeps_confirm_rule():
    # The read-back-confirm rule is a Task-9 safety property — persona edits must preserve it.
    from worker.fastlane import SYSTEM
    assert "confirmed=true" in SYSTEM and "read back" in SYSTEM
