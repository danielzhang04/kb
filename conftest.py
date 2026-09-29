import sys
import subprocess
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent / "scripts"))

# These tracked tests belong to optional/out-of-project runtimes. Keep repo-root collection from
# importing an unavailable Atlas aiohttp service or the FYT visual-kit scripts that open an external
# machine-specific .env at module import time. Runtime semantics in those projects remain untouched.
collect_ignore = ["atlas/tests/test_stateserver.py"]
collect_ignore_glob = [
    "orgs/faceless-youtube/channels/*/visual-kit/scripts/*_test.py",
]


def _quiet_creationflags(flags, platform):
    # Win32 constants are unavailable on Unix. Preserve explicit new-console/detached launches;
    # CREATE_NO_WINDOW would be ignored with these flags anyway.
    if platform != "win32" or flags & (0x00000010 | 0x00000008):
        return flags
    return flags | 0x08000000  # CREATE_NO_WINDOW, preserving all other caller flags


@pytest.fixture(scope="session", autouse=True)
def quiet_windows_test_children():
    """Pipe capture redirects output but does not prevent Windows allocating a console.

    Test helpers launch Git/Node/Python hundreds of times. Suppress their default consoles only
    inside pytest; production launch choices and explicitly requested consoles remain unchanged.
    """
    if sys.platform != "win32":
        yield
        return
    original = subprocess.Popen

    class QuietPopen(original):
        def __init__(self, *args, **kwargs):
            if len(args) > 13:  # Popen's positional creationflags parameter
                args = (*args[:13], _quiet_creationflags(args[13], "win32"), *args[14:])
            else:
                kwargs["creationflags"] = _quiet_creationflags(kwargs.get("creationflags", 0), "win32")
            super().__init__(*args, **kwargs)

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(subprocess, "Popen", QuietPopen)
        yield
