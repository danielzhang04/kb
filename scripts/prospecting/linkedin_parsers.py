"""Field-limited pure parsers for saved LinkedIn page HTML."""

from __future__ import annotations

from html.parser import HTMLParser


class _Fields(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.values: dict[str, str] = {}
        self.current: str | None = None
        self.depth = 0
        self.fields: list[tuple[str, int]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = dict(attrs)
        field = data.get("data-field")
        if field:
            self.fields.append((field, 1))
        elif self.fields:
            name, depth = self.fields[-1]
            self.fields[-1] = (name, depth + 1)
        self.current = self.fields[-1][0] if self.fields else None
        self.depth = self.fields[-1][1] if self.fields else 0
        if self.current and data.get("href"):
            self.values[self.current] = data["href"]

    def handle_data(self, data: str) -> None:
        if self.current and data.strip():
            self.values[self.current] = data.strip()

    def handle_endtag(self, tag: str) -> None:
        if self.fields:
            name, depth = self.fields[-1]
            if depth == 1:
                self.fields.pop()
            else:
                self.fields[-1] = (name, depth - 1)
        self.current = self.fields[-1][0] if self.fields else None
        self.depth = self.fields[-1][1] if self.fields else 0


def _parse(html: str) -> dict[str, str]:
    parser = _Fields()
    parser.feed(html)
    return parser.values


def parse_profile(html: str) -> dict[str, str]:
    allowed = {
        "first_name", "full_name", "title", "location", "linkedin_url", "company_name",
        "company_linkedin_url",
    }
    return {key: value for key, value in _parse(html).items() if key in allowed}


def parse_company(html: str) -> dict[str, str]:
    allowed = {"name", "website_url", "linkedin_url", "industry", "location", "one_line_summary"}
    return {key: value for key, value in _parse(html).items() if key in allowed}


def parse_search_results(html: str) -> tuple[dict[str, str], ...]:
    allowed = {"full_name", "title", "linkedin_url", "company_name"}
    rows = []
    for part in html.split('data-result="')[1:]:
        values = _parse(part.split("</article>", 1)[0])
        rows.append({key: value for key, value in values.items() if key in allowed})
    return tuple(rows)
