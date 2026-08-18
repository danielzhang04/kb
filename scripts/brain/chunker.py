"""Deterministic, dependency-free text chunking for the semantic brain."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from hashlib import sha1
from pathlib import Path
import re


_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_TARGET_SIZE = 500
MAX_CHUNK_CHARS = 900
_FENCE = re.compile(r"^\s*([`~]{3,})")

CHUNKER_VERSION = 2


@dataclass(frozen=True)
class Chunk:
    id: str
    source_path: str
    start_line: int
    end_line: int
    heading_path: list[str]
    text: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class _Paragraph:
    start_line: int
    end_line: int
    heading_path: list[str]
    text: str


def _chunk_id(source_path: str, start_line: int, end_line: int, text: str) -> str:
    # A text hash is included because giant-paragraph splitting can produce multiple
    # pieces that share the same (start_line, end_line) when the source paragraph has
    # no internal newlines (see _split_paragraph); the text hash keeps ids unique in
    # that case while remaining fully deterministic.
    text_hash = sha1(text.encode("utf-8")).hexdigest()[:8]
    value = f"{source_path}:{start_line}-{end_line}:{text_hash}"
    return sha1(value.encode("utf-8")).hexdigest()[:16]


def _make_chunk(source_path: str, paragraphs: list[_Paragraph]) -> Chunk:
    first, last = paragraphs[0], paragraphs[-1]
    text = "\n\n".join(paragraph.text for paragraph in paragraphs)
    return Chunk(
        id=_chunk_id(source_path, first.start_line, last.end_line, text),
        source_path=source_path,
        start_line=first.start_line,
        end_line=last.end_line,
        heading_path=first.heading_path,
        text=text,
    )


def _split_paragraph(paragraph: _Paragraph) -> list[_Paragraph]:
    """Split one overlong paragraph while retaining its source-line span."""
    if len(paragraph.text) <= MAX_CHUNK_CHARS:
        return [paragraph]

    pieces: list[_Paragraph] = []
    text = paragraph.text
    start = 0
    while len(text) - start > MAX_CHUNK_CHARS:
        limit = start + MAX_CHUNK_CHARS
        newline = text.rfind("\n", start, limit)
        sentence = max(
            text.rfind(mark, start, limit) for mark in (". ", "! ", "? ")
        )
        if newline > start:
            end = newline + 1
        elif sentence > start:
            end = sentence + 2
        else:
            end = limit
        start_line = paragraph.start_line + text.count("\n", 0, start)
        end_line = paragraph.start_line + text.count("\n", 0, end - 1)
        pieces.append(
            _Paragraph(start_line, end_line, paragraph.heading_path, text[start:end])
        )
        start = end
    start_line = paragraph.start_line + text.count("\n", 0, start)
    pieces.append(
        _Paragraph(start_line, paragraph.end_line, paragraph.heading_path, text[start:])
    )
    return pieces


def _merge_paragraphs(source_path: str, paragraphs: list[_Paragraph]) -> list[Chunk]:
    """Merge adjacent paragraphs without crossing a heading boundary."""
    chunks: list[Chunk] = []
    pending: list[_Paragraph] = []

    for paragraph in paragraphs:
        if pending and paragraph.heading_path != pending[0].heading_path:
            chunks.append(_make_chunk(source_path, pending))
            pending = []

        candidate_size = len("\n\n".join(item.text for item in [*pending, paragraph]))
        if pending and candidate_size > _TARGET_SIZE:
            chunks.append(_make_chunk(source_path, pending))
            pending = []
        pending.append(paragraph)

    if pending:
        chunks.append(_make_chunk(source_path, pending))
    return chunks


def _paragraphs(
    lines: list[str], heading_paths: list[list[str]], separators: list[bool] | None = None
) -> list[_Paragraph]:
    paragraphs: list[_Paragraph] = []
    start: int | None = None
    parts: list[str] = []
    active_path: list[str] = []

    def finish(end_line: int) -> None:
        nonlocal start, parts
        if start is not None:
            paragraphs.append(
                _Paragraph(start, end_line, active_path.copy(), "\n".join(parts))
            )
        start = None
        parts = []

    if separators is None:
        separators = [not line.strip() for line in lines]
    for number, (line, path, separator) in enumerate(
        zip(lines, heading_paths, separators), start=1
    ):
        if separator:
            finish(number - 1)
            continue
        if start is None:
            start = number
            active_path = path.copy()
        parts.append(line)
    finish(len(lines))
    return paragraphs


def chunk_markdown(text: str, source_path: str) -> list[Chunk]:
    """Split Markdown into paragraph groups while retaining heading context.

    Chunk IDs are derived from ``path:start-end`` plus a hash of the chunk text, so an
    edit that changes content without moving line numbers still changes the id — a known
    limitation until incremental indexing can reconcile edits more precisely.
    """
    lines = text.splitlines()
    headings: list[tuple[int, str]] = []
    content_lines: list[str] = []
    content_paths: list[list[str]] = []
    separators: list[bool] = []

    fence: tuple[str, int] | None = None
    for line in lines:
        fence_match = _FENCE.match(line)
        if fence is not None:
            content_lines.append(line)
            content_paths.append([title for _, title in headings])
            separators.append(False)
            if (
                fence_match
                and fence_match.group(1)[0] == fence[0]
                and len(fence_match.group(1)) >= fence[1]
            ):
                fence = None
            continue

        if fence_match:
            fence = (fence_match.group(1)[0], len(fence_match.group(1)))
            content_lines.append(line)
            content_paths.append([title for _, title in headings])
            separators.append(False)
            continue

        match = _HEADING.match(line)
        if match:
            level = len(match.group(1))
            title = match.group(2).strip()
            headings = [item for item in headings if item[0] < level]
            headings.append((level, title))
            # A heading ends the preceding paragraph and is not embedded itself.
            content_lines.append("")
            content_paths.append([title for _, title in headings])
            separators.append(True)
        else:
            content_lines.append(line)
            content_paths.append([title for _, title in headings])
            separators.append(not line.strip())

    # ``content_lines`` preserves original line numbers because headings occupy blanks.
    paragraphs = _paragraphs(content_lines, content_paths, separators)
    split_paragraphs = [piece for paragraph in paragraphs for piece in _split_paragraph(paragraph)]
    return _merge_paragraphs(source_path, split_paragraphs)


def _plain_chunks(text: str, source_path: str) -> list[Chunk]:
    lines = text.splitlines()
    paragraphs = _paragraphs(lines, [[] for _ in lines])
    split_paragraphs = [piece for paragraph in paragraphs for piece in _split_paragraph(paragraph)]
    return _merge_paragraphs(source_path, split_paragraphs)


def chunk_file(path: Path, repo_root: Path) -> list[Chunk]:
    """Chunk a file and record its repository-relative POSIX source path."""
    source_path = path.resolve().relative_to(repo_root.resolve()).as_posix()
    text = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix.lower() == ".md":
        return chunk_markdown(text, source_path)
    return _plain_chunks(text, source_path)
