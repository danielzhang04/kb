"""Typed-text debug REPL: the voice pipeline minus audio. Run (from atlas/):
   .venv\\Scripts\\python -m worker.repl     (needs ANTHROPIC_API_KEY in %USERPROFILE%\\.atlas\\env)

Reflex hits (design §7) are handled locally and echoed as `[reflex:<name>] <response>` — they never
reach the fast-lane LLM, exactly as the live worker routes them ahead of the turn."""
import os, sys
from pathlib import Path
import yaml

ATLAS = Path(__file__).resolve().parents[1]

def load_env():
    envfile = Path.home() / ".atlas" / "env"
    if envfile.is_file():
        for line in envfile.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

def _reflex_response(intent: str, last_atlas: str | None) -> str:
    """The local response the worker would speak for a reflex hit (text form for the REPL)."""
    if intent == "dismiss":
        return "Going to sleep."
    if intent == "cancel":
        return "Cancelled."
    if intent == "repeat":
        return last_atlas or "There's nothing to repeat yet."
    if intent == "credit":
        from worker import toolreg
        return toolreg.dispatch("credit_remaining", {})
    return ""

def main() -> int:
    load_env()
    import anthropic
    from worker import router, fastlane
    cfg = yaml.safe_load((ATLAS / "config" / "atlas.yaml").read_text(encoding="utf-8"))
    intents = router.load_intents(ATLAS / "config" / "intents.yaml")
    client = anthropic.Anthropic()
    last_atlas: str | None = None
    print("atlas repl — type a question, 'quit' to exit")
    while True:
        q = input("you> ").strip()
        if q.lower() in ("quit", "exit"):
            return 0
        if not q:
            continue
        lane, intent = router.route(q, intents)
        if lane == "reflex":
            resp = _reflex_response(intent, last_atlas)
            if intent != "dismiss":            # dismiss/cancel aren't atlas "answers" to repeat
                last_atlas = resp if intent == "credit" else last_atlas
            print(f"[reflex:{intent}] {resp}")
            continue
        answer = fastlane.answer(q, client=client, model=cfg["fast_model"],
                                 max_turns=cfg["max_tool_turns"])
        last_atlas = answer
        print("atlas>", answer)

if __name__ == "__main__":
    sys.exit(main())
