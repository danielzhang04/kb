import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "scripts"))

# These tracked tests belong to optional/out-of-project runtimes. Keep repo-root collection from
# importing an unavailable Atlas aiohttp service or the FYT visual-kit scripts that open an external
# machine-specific .env at module import time. Runtime semantics in those projects remain untouched.
collect_ignore = ["atlas/tests/test_stateserver.py"]
collect_ignore_glob = [
    "orgs/faceless-youtube/channels/*/visual-kit/scripts/*_test.py",
]
