"""P2 extensions to the immutable P1 prospecting store surface."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass

from scripts.prospecting.store import (
    LANE_CODES,
    TargetPolicy as P1TargetPolicy,
    compile_target_policy as compile_p1_target_policy,
    validate_target_policy as validate_p1_target_policy,
)


@dataclass(frozen=True)
class TargetPolicy(P1TargetPolicy):
    enabled: bool = False
    lanes: tuple[str, ...] = ()
    domain_allowlist: tuple[str, ...] = ()

    @property
    def policy_hash(self) -> str:
        """Return the stable hash for this normalized P2 policy."""
        canonical = json.dumps(
            {
                "predicates": [
                    {
                        "predicate_id": predicate.predicate_id,
                        "type": predicate.type,
                        "value": predicate.value,
                    }
                    for predicate in self.predicates
                ],
                "requested_companies": self.requested_companies,
                "requested_people": self.requested_people,
                "extra_fields": self.extra_fields,
                "lane_plan": self.lane_plan,
                "scorer_version": self.scorer_version,
                "enabled": self.enabled,
                "lanes": self.lanes,
                "domain_allowlist": self.domain_allowlist,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_target_policy(policy: TargetPolicy) -> None:
    validate_p1_target_policy(policy)
    if type(policy.enabled) is not bool:
        raise ValueError("enabled must be a boolean")
    for lane in policy.lanes:
        if lane not in LANE_CODES:
            raise ValueError("lanes must contain enumerated lanes")
    if any(not isinstance(host, str) or not host for host in policy.domain_allowlist):
        raise ValueError("domain_allowlist must contain hostnames")
    if "linkedin_assisted" in policy.lanes and set(policy.domain_allowlist) != {"www.linkedin.com"}:
        raise ValueError("linkedin_domain_allowlist_must_be_exact")


def compile_target_policy(
    raw: Mapping[str, object], resolve_company: Callable[[str], str | None]
) -> TargetPolicy:
    policy = compile_p1_target_policy(raw, resolve_company)
    p2_policy = TargetPolicy(
        policy.predicates,
        policy.requested_companies,
        policy.requested_people,
        policy.extra_fields,
        policy.lane_plan,
        policy.scorer_version,
        bool(raw.get("enabled", False)),
        tuple(str(item) for item in raw.get("lanes", ())),  # type: ignore[union-attr]
        tuple(str(item) for item in raw.get("domain_allowlist", ())),  # type: ignore[union-attr]
    )
    validate_target_policy(p2_policy)
    return p2_policy
