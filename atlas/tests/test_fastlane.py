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

def test_tool_names_cover_v0_surface():
    assert {t["name"] for t in TOOLS} == {
        "queue_summary", "read_dashboard", "read_state", "ledger_rollup", "running_work"}
