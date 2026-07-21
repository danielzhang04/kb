"""sanitize_for_tts (conversation-rules design §2): markdown never reaches the speaker."""
from worker.sanitize import sanitize_for_tts


def test_bold_and_backticks_stripped():
    assert sanitize_for_tts("you've got **three active projects**") == "you've got three active projects"
    assert sanitize_for_tts("one card in `working` right now") == "one card in working right now"


def test_marker_chars_stripped_even_when_split_across_chunks():
    # streaming: "**bold**" may arrive as "*", "*bold*", "*" — char-level strip survives any split
    assert sanitize_for_tts("*") == ""
    assert sanitize_for_tts("*bold*") == "bold"


def test_headers_and_bullets_dropped():
    assert sanitize_for_tts("# Status\n- one card\n- two cards") == "Status\none card\ntwo cards"
    assert sanitize_for_tts("1. first\n2. second") == "first\nsecond"


def test_links_collapse_to_text():
    assert sanitize_for_tts("see [the dashboard](http://x) for more") == "see the dashboard for more"


def test_underscores_become_spaces_and_whitespace_not_stripped():
    assert sanitize_for_tts("file_card is ready") == "file card is ready"
    # chunk boundaries: single leading/trailing spaces are word separators — preserved
    assert sanitize_for_tts(" and then ") == " and then "


def test_hash_in_pr_number_reads_clean():
    assert sanitize_for_tts("PR #44 merged") == "PR 44 merged"


def test_plain_speech_untouched():
    text = "Quiet. Twenty-ish cards in inbox, four working, nothing stuck."
    assert sanitize_for_tts(text) == text
