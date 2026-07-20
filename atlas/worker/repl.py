"""Typed-text debug REPL: the voice pipeline minus audio. Run (from atlas/):
   .venv\\Scripts\\python -m worker.repl     (needs ANTHROPIC_API_KEY in %USERPROFILE%\\.atlas\\env)"""
import os, sys
from pathlib import Path
import yaml

def load_env():
    envfile = Path.home() / ".atlas" / "env"
    if envfile.is_file():
        for line in envfile.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

def main() -> int:
    load_env()
    import anthropic
    from worker.router import route
    from worker import fastlane
    cfg = yaml.safe_load((Path(__file__).resolve().parents[1] / "config" / "atlas.yaml").read_text(encoding="utf-8"))
    client = anthropic.Anthropic()
    print("atlas repl — type a question, 'quit' to exit")
    while True:
        q = input("you> ").strip()
        if q.lower() in ("quit", "exit"):
            return 0
        if not q:
            continue
        assert route(q) == "fast"
        print("atlas>", fastlane.answer(q, client=client, model=cfg["fast_model"],
                                        max_turns=cfg["max_tool_turns"]))

if __name__ == "__main__":
    sys.exit(main())
