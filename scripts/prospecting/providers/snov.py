"""Fixture-capable Snov work-email finder, sharing the bounded Hunter transport surface."""

from pathlib import Path

from scripts.prospecting.providers.hunter import HunterEmailFinder


class SnovEmailFinder(HunterEmailFinder):
    provider = "snov"

    def __init__(self, fixture_dir: Path | None = None, transport=None) -> None:
        super().__init__(fixture_dir or Path("orgs/prospecting/fixtures/vendor/snov"), transport)
