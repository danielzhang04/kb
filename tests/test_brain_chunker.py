from pathlib import Path

from scripts.brain.chunker import MAX_CHUNK_CHARS, chunk_file, chunk_markdown


def test_markdown_heading_paths_and_line_numbers() -> None:
    text = "# Guide\n\nIntro first.\n\n## Details\n\nLine one\nline two.\n\nFinal.\n"

    chunks = chunk_markdown(text, "docs/guide.md")

    assert [(chunk.heading_path, chunk.start_line, chunk.end_line) for chunk in chunks] == [
        (["Guide"], 3, 3),
        (["Guide", "Details"], 7, 10),
    ]
    assert chunks[1].text == "Line one\nline two.\n\nFinal."


def test_adjacent_paragraphs_merge_to_target_size() -> None:
    paragraph = "x" * 240
    text = "# Notes\n\n" + "\n\n".join([paragraph] * 4)

    chunks = chunk_markdown(text, "memory/notes.md")

    assert len(chunks) == 2
    assert all(300 <= len(chunk.text) <= 500 for chunk in chunks)


def test_non_markdown_uses_plain_paragraph_fallback(tmp_path: Path) -> None:
    path = tmp_path / "notes.txt"
    path.write_text("First paragraph.\n\nSecond paragraph.", encoding="utf-8")

    chunks = chunk_file(path, tmp_path)

    assert len(chunks) == 1
    assert chunks[0].source_path == "notes.txt"
    assert chunks[0].heading_path == []
    assert chunks[0].start_line == 1
    assert chunks[0].end_line == 3


def test_chunk_ids_are_deterministic() -> None:
    text = "# Title\n\nA stable paragraph.\n"

    first = chunk_markdown(text, "docs/stable.md")
    second = chunk_markdown(text, "docs/stable.md")

    assert [chunk.id for chunk in first] == [chunk.id for chunk in second]
    assert first[0].id == "52aade477d9f18e7"


def test_fenced_heading_is_preserved_without_changing_heading_path() -> None:
    text = (
        "# Guide\n\n"
        "```python\n"
        "# not a heading\n"
        "\n"
        "print('kept')\n"
        "```\n\n## After\n\n"
        "Text after the fence.\n"
    )

    chunks = chunk_markdown(text, "docs/fences.md")

    assert chunks[0].heading_path == ["Guide"]
    assert chunks[0].text == "```python\n# not a heading\n\nprint('kept')\n```"
    assert chunks[1].heading_path == ["Guide", "After"]
    assert chunks[1].text == "Text after the fence."


def test_chunker_hard_caps_giant_paragraphs_and_blank_line_free_lists() -> None:
    giant = "Sentence boundary. " * 80
    hard_cut = "x" * 901
    list_items = "\n".join(f"- item {number}: " + "detail " * 24 for number in range(20))

    chunks = chunk_markdown(
        f"# Large\n\n{giant}\n\n{hard_cut}\n\n{list_items}\n", "docs/large.md"
    )

    assert len(chunks) > 2
    assert all(len(chunk.text) <= MAX_CHUNK_CHARS for chunk in chunks)
    assert all(len(chunk.text) <= 900 for chunk in chunks)
    assert chunks[-1].end_line == 26
    assert len({chunk.id for chunk in chunks}) == len(chunks)
