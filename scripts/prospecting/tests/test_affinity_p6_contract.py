"""Pins the P6 fill helpers consumed by the P8 fit-first wrapper."""

from __future__ import annotations

import dataclasses
import inspect

from scripts.prospecting.operator import fill


BORROWED = {
    "backfill_company_domains": ("connection", "company_ids"),
    "_candidate_rows": ("connection", "company_id", "maximum"),
    "_queue_discovery": ("connection", "campaign_id", "company_id", "policy_hash", "maximum",
                         "min_confidence", "at", "max_pages_per_firm"),
    "_queue_email": ("connection", "campaign_id", "policy_hash", "person_id", "at", "queue_email"),
    "_mark_person": ("connection", "campaign_id", "company_id", "person_id", "title",
                     "source_page", "substituted", "at"),
    "_request_id": ("campaign_id", "person_id"),
    "_has_confident_contact": ("connection", "person_id", "min_confidence"),
    "_finished_without_contact": ("connection", "campaign_id", "person_id", "min_confidence"),
    "queue_firm_profiles": ("connection", "campaign_id", "policy_hash", "at", "min_confidence"),
    "seniority_class": ("title",),
}
BORROWED_TYPES = ("FillSummary",)


def test_every_borrowed_p6_function_keeps_its_signature() -> None:
    for name, expected in BORROWED.items():
        assert tuple(inspect.signature(getattr(fill, name)).parameters) == expected, name


def test_fill_summary_stays_the_frozen_shape_fit_fill_summary_wraps() -> None:
    for name in BORROWED_TYPES:
        assert dataclasses.is_dataclass(getattr(fill, name))
    assert getattr(fill, "FillSummary").__dataclass_params__.frozen
