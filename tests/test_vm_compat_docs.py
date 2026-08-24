"""Pin the VM recipe and optional-workflow boundary to executable behavior."""

import json
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess

from scripts.brain import indexer
from scripts.build_platform_release import RELEASE_ROOTS


ROOT = Path(__file__).resolve().parents[1]
PROPOSAL = ROOT / "docs" / "proposals" / "brain-query-runtime.md"


def test_state_root_resolution_has_one_implementation_per_language() -> None:
    python_consumers = [
        path for path in (ROOT / "scripts").rglob("*.py")
        if path.name != "kb_paths.py"
    ]
    python_text = "\n".join(path.read_text(encoding="utf-8") for path in python_consumers)
    assert "def resolve_state_root(" not in python_text
    assert not re.search(r"(?:os\.environ|env)\.get\([\"']DASHBOARD_STATE_ROOT", python_text)

    helpers = {
        ROOT / "scripts" / "hooks" / "lib" / "kb_paths.js",
        ROOT / "dashboard" / "server" / "composer" / "store.ts",
        # Main-owned acceptance fixture assignment, not a state-root read.
        ROOT / "dashboard" / "server" / "control" / "synthetic-acceptance.ts",
        # P3 authenticated fixture: sets the variable to route its temp root through the
        # production reader, then restores it — an assignment, not a second implementation.
        ROOT / "dashboard" / "server" / "testFixtures" / "p3AuthenticatedServer.ts",
    }
    js_consumers = [
        path for base in (ROOT / "scripts" / "hooks", ROOT / "dashboard" / "server")
        for pattern in ("*.js", "*.ts")
        for path in base.rglob(pattern)
        if path not in helpers and not path.name.endswith(".test.ts")
    ]
    js_text = "\n".join(path.read_text(encoding="utf-8") for path in js_consumers)
    uncommented = re.sub(r"/\*.*?\*/|//[^\n]*", "", js_text, flags=re.DOTALL)
    assert not re.search(r"(?:process\.env|\benv)\.DASHBOARD_STATE_ROOT", uncommented)


def _recipe_commands() -> list[list[str]]:
    text = PROPOSAL.read_text(encoding="utf-8")
    fences = re.findall(r"```(?:sh|bash)\n(.*?)\n```", text, flags=re.DOTALL)
    return [
        shlex.split(line, posix=True)
        for fence in fences
        for line in fence.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def test_brain_vm_recipe_has_the_real_cli_and_explicit_service_paths() -> None:
    commands = _recipe_commands()
    modules = {}
    for argv in commands:
        python = argv.index("python3")
        assert argv[python:python + 2] == ["python3", "-m"]
        module = argv[python + 2]
        modules[module] = argv
        assignments = argv[argv.index("env") + 1:python]
        assert {assignment.split("=", 1)[0] for assignment in assignments} == {
            "PYTHONPATH", "DASHBOARD_STATE_ROOT", "DASHBOARD_REPO_ROOT",
        }

    assert set(modules) == {"scripts.brain.fetch_model", "scripts.brain.indexer"}
    build = modules["scripts.brain.indexer"]
    marker = build.index("scripts.brain.indexer")
    args = indexer.parse_args(build[marker + 1:])
    assert args.command == "build"
    assert args.root == Path("/var/lib/kb/ops")


def _server_import_spawn_graph() -> dict[str, dict[str, object]]:
    script = r"""
import path from 'node:path';
import { API } from 'typescript/unstable/sync';
import * as ts from 'typescript/unstable/ast';
const root = path.resolve('server');
const graph = {};
const api = new API({ cwd: process.cwd() });
try {
  const snapshot = api.updateSnapshot({ openProjects: [path.resolve('tsconfig.json')] });
  const program = snapshot.getProjects()[0].program;
  for (const file of program.getSourceFileNames().filter((name) => path.resolve(name).startsWith(root + path.sep) && name.endsWith('.ts'))) {
    const source = program.getSourceFile(file);
    const imports = [];
    const spawns = [];
    function visit(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node)) {
        const callee = ts.isIdentifier(node.expression) ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '';
        if (['spawn', 'execFile', 'resolvePython'].includes(callee)) {
          const literals = [];
          const collect = (part) => {
            if (ts.isStringLiteralLikeNode(part)) literals.push(part.text);
            else part.forEachChild(collect);
          };
          node.arguments.forEach(collect);
          spawns.push({ callee, literals });
        }
      }
      node.forEachChild(visit);
    }
    visit(source);
    graph[path.relative(root, file).replaceAll('\\', '/')] = { imports, spawns };
  }
} finally {
  api.close();
}
process.stdout.write(JSON.stringify(graph));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT / "dashboard", check=True,
        text=True, capture_output=True,
    )
    return json.loads(result.stdout)


def test_server_graph_and_release_roots_keep_eval_workflows_conditional() -> None:
    graph = _server_import_spawn_graph()
    assert "brain/routes.ts" in graph
    literals = [
        literal
        for node in graph.values()
        for literal in [
            *node["imports"],
            *(value for call in node["spawns"] for value in call["literals"]),
        ]
    ]
    for forbidden in ("promotion", "agent_evals"):
        assert not any(forbidden in literal for literal in literals)
    release_paths = [PurePosixPath(root) for root in RELEASE_ROOTS]
    assert not any(path.parts[0] == "evals" for path in release_paths)
    assert not any(path.name == "requirements-dev.txt" for path in release_paths)
