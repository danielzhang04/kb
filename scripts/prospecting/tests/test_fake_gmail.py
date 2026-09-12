from __future__ import annotations

import pytest

from scripts.prospecting.campaigner.fake_gmail import ArrivalPoint, FakeGmail
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


SYNTHETIC = legacy_fixture("test_fake_gmail")


def test_fake_models_thread_headers_labels_history_and_search() -> None:
    gmail = FakeGmail()
    root = gmail.seed_outbound(subject="Coffee", rfc_message_id=SYNTHETIC["root_message_id"])
    draft = gmail.draft_in_thread(
        thread_id=root.thread_id,
        subject="Coffee",
        body="Synthetic body",
        rfc_message_id=SYNTHETIC["follow_message_id"],
        in_reply_to=SYNTHETIC["root_message_id"],
        references=(SYNTHETIC["root_message_id"],),
    )
    gmail.modify_labels(root.thread_id, add=("Outreach/Follow-up due",), remove=())
    thread = gmail.thread_get(root.thread_id)
    assert [message.message_id for message in thread.messages] == [
        root.message_id,
        draft.message_id,
    ]
    assert draft.headers["In-Reply-To"] == SYNTHETIC["root_message_id"]
    assert draft.headers["References"] == SYNTHETIC["root_message_id"]
    assert thread.labels == {"Outreach/Follow-up due"}
    assert gmail.messages_list("rfc822msgid:" + SYNTHETIC["follow_message_id"]) == (draft,)
    assert len(gmail.history_list("0")) == 3


@pytest.mark.parametrize("point", list(ArrivalPoint), ids=[point.value for point in ArrivalPoint])
def test_inbound_arrives_only_at_selected_point(point: ArrivalPoint) -> None:
    gmail = FakeGmail()
    root = gmail.seed_outbound(subject="Coffee", rfc_message_id=SYNTHETIC["root_message_id"])
    gmail.queue_inbound(
        point,
        thread_id=root.thread_id,
        subject="Coffee",
        headers={"In-Reply-To": SYNTHETIC["root_message_id"]},
        body="Synthetic reply",
    )
    for candidate in ArrivalPoint:
        created = gmail.arrive(candidate)
        assert bool(created) is (candidate is point)
    assert len(gmail.thread_get(root.thread_id).messages) == 2


def test_fake_rejects_invalid_threading() -> None:
    gmail = FakeGmail()
    root = gmail.seed_outbound(subject="Coffee", rfc_message_id=SYNTHETIC["root_message_id"])
    with pytest.raises(ValueError, match="thread_subject_mismatch"):
        gmail.draft_in_thread(
            root.thread_id, "Different", "Synthetic", SYNTHETIC["bad_message_id"],
            SYNTHETIC["root_message_id"], (SYNTHETIC["root_message_id"],),
        )
