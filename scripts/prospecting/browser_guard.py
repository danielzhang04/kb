"""Pure navigation and action guards for the executor-owned browser lane."""

from __future__ import annotations

from dataclasses import dataclass
from importlib.metadata import version
import os
from pathlib import Path
from typing import Mapping
from urllib.parse import urlsplit


@dataclass(frozen=True)
class BrowserPolicy:
    allowed_hosts: tuple[str, ...]
    rolling_cap: int = 40
    session_seconds: int = 1800


LINKEDIN_HOST = "www.linkedin.com"
CHROME_CHANNEL = "chrome"
DEDICATED_PROFILE_NAME = "kb-outreach-chrome"
PLAYWRIGHT_VERSION = "1.49.1"


def check_navigation(url: str, policy: BrowserPolicy) -> None:
    parsed = urlsplit(url)
    if parsed.scheme == "file" and os.environ.get("KB_PROSPECTING_NO_NETWORK") == "1":
        return
    if parsed.scheme != "https" or parsed.hostname not in policy.allowed_hosts:
        raise ValueError("browser_domain_blocked")
    if not parsed.path.startswith(("/search/results/people/", "/in/", "/company/")):
        raise ValueError("browser_action_blocked")


def next_delay(random_source: object) -> int:
    return random_source.randint(45, 120)  # type: ignore[attr-defined]


def check_action(action: str) -> None:
    allowed = {"search_results", "profile_page", "company_page", "close", "wait"}
    if action not in allowed:
        raise ValueError(f"browser_action_blocked:{action}")


def detect_stop(html: str) -> str | None:
    lowered = html.casefold()
    markers = ("captcha", "checkpoint", "rate warning", "login challenge", "unexpected modal")
    return next((marker.replace(" ", "_") for marker in markers if marker in lowered), None)


def validate_dedicated_launch(user_data_dir: Path, channel: str) -> None:
    """Reject any browser launch that is not the single LinkedIn profile."""
    expected = dedicated_user_data_dir()
    if user_data_dir != expected or channel != CHROME_CHANNEL:
        raise ValueError("browser_profile_refused")


def open_persistent_page(user_data_dir: Path, channel: str = CHROME_CHANNEL) -> object:
    """Open the only permitted persistent Chrome profile for this lane.

    This import is deliberately inside the live-only boundary so dry runs and unit tests
    do not require Playwright to be installed.
    """
    validate_dedicated_launch(user_data_dir, channel)
    if version("playwright") != PLAYWRIGHT_VERSION:
        raise RuntimeError("playwright_version_refused")
    from playwright.sync_api import sync_playwright

    playwright = sync_playwright().start()
    chromium = playwright.chromium
    context = chromium.launch_persistent_context(
        str(user_data_dir), channel=channel, headless=False
    )
    page = context.pages[0] if context.pages else context.new_page()
    # The lane closes this page. Keep its owning resources reachable for orderly close.
    setattr(page, "_kb_browser_context", context)
    setattr(page, "_kb_playwright", playwright)
    return page


def close_persistent_page(page: object) -> None:
    """Close the page and the persistent resources created for this session."""
    page.close()  # type: ignore[attr-defined]
    context = getattr(page, "_kb_browser_context", None)
    if context is not None:
        context.close()
    playwright = getattr(page, "_kb_playwright", None)
    if playwright is not None:
        playwright.stop()


def dedicated_user_data_dir(environ: Mapping[str, str] | None = None) -> Path:
    values = os.environ if environ is None else environ
    root = values.get("LOCALAPPDATA")
    if not root:
        raise RuntimeError("localappdata_unavailable")
    return Path(root) / DEDICATED_PROFILE_NAME
