"""No process launch needed to verify the pytest-only Win32 flag policy."""
from conftest import _quiet_creationflags


def test_windows_default_children_are_hidden_without_losing_other_flags():
    assert _quiet_creationflags(0, "win32") == 0x08000000
    assert _quiet_creationflags(0x00000200, "win32") == 0x08000200
    assert _quiet_creationflags(0x08000000, "win32") == 0x08000000


def test_explicit_console_and_detached_choices_are_preserved():
    for flags in (0x10, 0x08, 0x10 | 0x200, 0x08 | 0x200):
        assert _quiet_creationflags(flags, "win32") == flags


def test_other_platforms_are_unchanged():
    for flags in (0, 0x200):
        assert _quiet_creationflags(flags, "linux") == flags
