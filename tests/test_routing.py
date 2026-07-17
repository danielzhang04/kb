"""Phase R1.1 / R1.4 — routing precedence resolver + routed-vs-ran audit.

All fixtures are tmp-path yaml: the real governance/model-routing.yaml does NOT
exist yet (Daniel commits it at gate R1.0), so the resolver must behave correctly
both with a fixture policy and with none at all.
"""
import datetime

import cards
import ledger
import pytest
import routing

# A policy fixture mirroring docs/proposals/model-routing-yaml-proposal.md §1.
POLICY_YAML = """\
version: 1
runtimes:
  claude:
    default_worker: worker-desktop
    aliases:
      opus: claude-opus-4-8
      sonnet: claude-sonnet-5
      haiku: claude-haiku-4-5
    known_models: [claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5]
  codex:
    default_worker: codex-worker
    aliases:
      codex: gpt-5-codex
    known_models: [gpt-5-codex]
policy:
  scout:
    "*": { runtime: claude, model: haiku }
  manage:
    "*": { runtime: claude, model: opus }
  work:
    T1: { runtime: claude, model: sonnet }
    T2: { runtime: claude, model: sonnet }
    T3: { runtime: claude, model: opus }
  inspect:
    "*": { runtime: claude, model: opus }
  consolidate:
    "*": { runtime: claude, model: opus }
role_default: { runtime: claude, model: sonnet }
"""


def _write_policy(repo_root, text=POLICY_YAML):
    gov = repo_root / "governance"
    gov.mkdir(parents=True, exist_ok=True)
    (gov / "model-routing.yaml").write_text(text, encoding="utf-8")


def _write_override(repo_root, text):
    queue = repo_root / "queue"
    queue.mkdir(parents=True, exist_ok=True)
    (queue / "routing-override.yaml").write_text(text, encoding="utf-8")


def _meta(**kw):
    """A minimal card_meta for resolve() — id/owner drive override matching;
    runtime/model default to None (a legacy/fresh card)."""
    meta = {"id": "card-1", "owner": "worker-desktop", "runtime": None, "model": None}
    meta.update(kw)
    return meta


# --------------------------------------------------------------------------- #
# Policy rung                                                                  #
# --------------------------------------------------------------------------- #
def test_policy_role_tier_lookup(tmp_path):
    _write_policy(tmp_path)
    policy = routing.load_policy(tmp_path)
    override = routing.load_override(tmp_path)

    r = routing.resolve(_meta(), "work", "T3", policy, override)
    assert r == routing.Routed("claude", "claude-opus-4-8", "policy", "policy")

    r = routing.resolve(_meta(), "scout", "T1", policy, override)
    assert (r.runtime, r.model) == ("claude", "claude-haiku-4-5")
    assert r.source_runtime == r.source_model == "policy"


def test_policy_star_tier_fallback(tmp_path):
    _write_policy(tmp_path)
    policy = routing.load_policy(tmp_path)
    override = routing.load_override(tmp_path)
    # `manage` has only "*": every tier resolves identically.
    for tier in ("T1", "T2", "T3"):
        r = routing.resolve(_meta(), "manage", tier, policy, override)
        assert (r.runtime, r.model) == ("claude", "claude-opus-4-8"), tier


def test_role_default_when_role_absent_from_policy(tmp_path):
    _write_policy(tmp_path)
    policy = routing.load_policy(tmp_path)
    override = routing.load_override(tmp_path)
    # A role with no policy[role] entry falls to the file's role_default,
    # still with source == "policy" (the role-prose default rung).
    r = routing.resolve(_meta(), "some-future-role", "T2", policy, override)
    assert (r.runtime, r.model) == ("claude", "claude-sonnet-5")
    assert r.source_runtime == r.source_model == "policy"


# --------------------------------------------------------------------------- #
# Card frontmatter rung (top precedence)                                      #
# --------------------------------------------------------------------------- #
def test_card_frontmatter_outranks_everything(tmp_path):
    _write_policy(tmp_path)
    _write_override(tmp_path, """\
version: 1
overrides:
  - scope: agent
    key: worker-desktop
    runtime: claude
    model: claude-sonnet-5
""")
    policy = routing.load_policy(tmp_path)
    override = routing.load_override(tmp_path)
    meta = _meta(runtime="codex", model="gpt-5-codex")
    r = routing.resolve(meta, "work", "T3", policy, override)
    assert (r.runtime, r.model) == ("codex", "gpt-5-codex")
    assert r.source_runtime == r.source_model == "card"


# --------------------------------------------------------------------------- #
# Override rung                                                                #
# --------------------------------------------------------------------------- #
def test_override_card_scope_beats_agent_scope(tmp_path):
    _write_policy(tmp_path)
    _write_override(tmp_path, """\
version: 1
overrides:
  - scope: agent
    key: worker-desktop
    runtime: claude
    model: claude-sonnet-5
  - scope: card
    key: card-1
    runtime: codex
    model: gpt-5-codex
""")
    policy = routing.load_policy(tmp_path)
    override = routing.load_override(tmp_path)
    r = routing.resolve(_meta(), "work", "T3", policy, override)
    assert (r.runtime, r.model) == ("codex", "gpt-5-codex")
    assert r.source_runtime == r.source_model == "override"


def test_override_beats_policy_but_not_card(tmp_path):
    _write_policy(tmp_path)
    _write_override(tmp_path, """\
version: 1
overrides:
  - scope: card
    key: card-1
    runtime: claude
    model: claude-haiku-4-5
""")
    policy = routing.load_policy(tmp_path)
    override = routing.load_override(tmp_path)

    # override outranks policy
    r = routing.resolve(_meta(), "work", "T3", policy, override)
    assert (r.runtime, r.model) == ("claude", "claude-haiku-4-5")
    assert r.source_model == "override"

    # but a non-null card field outranks the override
    r2 = routing.resolve(_meta(model="claude-opus-4-8"), "work", "T3", policy, override)
    assert r2.model == "claude-opus-4-8"
    assert r2.source_model == "card"


def test_partial_override_model_only_keeps_policy_runtime(tmp_path):
    _write_policy(tmp_path)
    _write_override(tmp_path, """\
version: 1
overrides:
  - scope: card
    key: card-1
    model: claude-haiku-4-5
""")
    policy = routing.load_policy(tmp_path)
    override = routing.load_override(tmp_path)
    r = routing.resolve(_meta(), "work", "T3", policy, override)
    # model from the override, runtime falls through to policy — field-by-field.
    assert r.model == "claude-haiku-4-5"
    assert r.source_model == "override"
    assert r.runtime == "claude"
    assert r.source_runtime == "policy"


def test_expired_override_entry_ignored(tmp_path):
    _write_policy(tmp_path)
    _write_override(tmp_path, """\
version: 1
overrides:
  - scope: card
    key: card-1
    runtime: codex
    model: gpt-5-codex
    expires: 2000-01-01T00:00:00Z
""")
    policy = routing.load_policy(tmp_path)
    override = routing.load_override(tmp_path)
    r = routing.resolve(_meta(), "work", "T3", policy, override)
    # Expired -> treated as absent -> policy (work/T3 = opus).
    assert (r.runtime, r.model) == ("claude", "claude-opus-4-8")
    assert r.source_model == "policy"


def test_future_override_entry_still_applies(tmp_path):
    _write_policy(tmp_path)
    _write_override(tmp_path, """\
version: 1
overrides:
  - scope: card
    key: card-1
    model: claude-haiku-4-5
    expires: 2999-01-01T00:00:00Z
""")
    policy = routing.load_policy(tmp_path)
    override = routing.load_override(tmp_path)
    r = routing.resolve(_meta(), "work", "T3", policy, override)
    assert r.model == "claude-haiku-4-5"
    assert r.source_model == "override"


def test_last_wins_same_scope_and_key(tmp_path):
    _write_policy(tmp_path)
    _write_override(tmp_path, """\
version: 1
overrides:
  - scope: card
    key: card-1
    model: claude-haiku-4-5
  - scope: card
    key: card-1
    model: claude-opus-4-8
""")
    policy = routing.load_policy(tmp_path)
    override = routing.load_override(tmp_path)
    r = routing.resolve(_meta(), "work", "T1", policy, override)
    assert r.model == "claude-opus-4-8"  # the LAST same scope+key entry wins


# --------------------------------------------------------------------------- #
# Fail-loud / fail-open                                                        #
# --------------------------------------------------------------------------- #
def test_unknown_model_raises_routing_error(tmp_path):
    _write_policy(tmp_path)
    policy = routing.load_policy(tmp_path)
    override = routing.load_override(tmp_path)
    meta = _meta(runtime="claude", model="claude-ultra-9")  # not in known_models
    with pytest.raises(routing.RoutingError):
        routing.resolve(meta, "work", "T3", policy, override)


def test_corrupt_override_falls_back_to_policy(tmp_path):
    _write_policy(tmp_path)
    _write_override(tmp_path, "version: 1\noverrides: [ unclosed\n")  # unparseable
    policy = routing.load_policy(tmp_path)
    override = routing.load_override(tmp_path)
    assert override == {"overrides": []}
    r = routing.resolve(_meta(), "work", "T3", policy, override)
    assert (r.runtime, r.model) == ("claude", "claude-opus-4-8")
    assert r.source_model == "policy"


def test_schema_invalid_override_falls_back_to_policy(tmp_path):
    _write_policy(tmp_path)
    # parses as yaml but `overrides` is not a list
    _write_override(tmp_path, "version: 1\noverrides: not-a-list\n")
    override = routing.load_override(tmp_path)
    assert override == {"overrides": []}


def test_missing_policy_uses_safe_default(tmp_path):
    # No governance/model-routing.yaml at all.
    policy = routing.load_policy(tmp_path)
    override = routing.load_override(tmp_path)
    assert policy == {}
    r = routing.resolve(_meta(), "work", "T3", policy, override)
    assert (r.runtime, r.model) == routing.SAFE_DEFAULT
    assert r.source_runtime == r.source_model == "default"


def test_corrupt_policy_uses_safe_default(tmp_path):
    _write_policy(tmp_path, "this: [is: not: valid: yaml\n")
    policy = routing.load_policy(tmp_path)
    assert policy == {}
    r = routing.resolve(_meta(), "work", "T3", policy, routing.load_override(tmp_path))
    assert (r.runtime, r.model) == routing.SAFE_DEFAULT
    assert r.source_model == "default"


def test_safe_default_never_raises_without_registry(tmp_path):
    # Absent policy => no registry => the unknown-model guard cannot run and must
    # NOT fail closed on the safe default.
    r = routing.resolve(_meta(), "work", "T3", {}, {"overrides": []})
    assert (r.runtime, r.model) == routing.SAFE_DEFAULT


# --------------------------------------------------------------------------- #
# Owner / registry helpers                                                     #
# --------------------------------------------------------------------------- #
def test_owner_runtime_registry_lookup(tmp_path):
    _write_policy(tmp_path)
    policy = routing.load_policy(tmp_path)
    assert routing.default_worker_for(policy, "claude") == "worker-desktop"
    assert routing.default_worker_for(policy, "codex") == "codex-worker"
    assert routing.default_worker_for(policy, "gemini") is None  # unregistered
    assert routing.default_worker_for({}, "claude") is None  # no policy


def test_runtime_of_worker_reverse_lookup(tmp_path):
    _write_policy(tmp_path)
    policy = routing.load_policy(tmp_path)
    assert routing.runtime_of_worker(policy, "codex-worker") == "codex"
    assert routing.runtime_of_worker(policy, "worker-desktop") == "claude"
    assert routing.runtime_of_worker(policy, "dispatcher-cloud") is None


# --------------------------------------------------------------------------- #
# R1.4 — routed-vs-ran audit                                                   #
# --------------------------------------------------------------------------- #
def _stamped_card(repo_root, *, runtime, model, card_id=None):
    card = cards.new_card("kb", "a", "t", "T1", body="## Work order\n\nx\n", state="done")
    if card_id:
        card.meta["id"] = card_id
    cards.stamp_routing(card, runtime, model)
    cards.save(card, repo_root / "queue")
    return card.meta["id"]


def test_audit_flags_routed_vs_ran_model_mismatch(tmp_path):
    _write_policy(tmp_path)
    cid = _stamped_card(tmp_path, runtime="claude", model="claude-opus-4-8")
    day = datetime.date.today().isoformat()
    ledger.append(tmp_path, "cost", "worker-desktop",
                  {"usd": 0.0, "billing": "subscription",
                   "model": "claude-sonnet-5", "card_id": cid, "codex_exit": "0"})

    mismatches = routing.audit_routed_vs_ran(tmp_path, day)
    assert len(mismatches) == 1
    m = mismatches[0]
    assert m.card_id == cid
    assert m.routed_model == "claude-opus-4-8"
    assert m.ran_model == "claude-sonnet-5"
    assert m.kind == "model"  # same runtime (claude) -> mere model drift


def test_audit_no_mismatch_when_models_match(tmp_path):
    _write_policy(tmp_path)
    cid = _stamped_card(tmp_path, runtime="claude", model="claude-opus-4-8")
    day = datetime.date.today().isoformat()
    ledger.append(tmp_path, "cost", "worker-desktop",
                  {"usd": 0.0, "billing": "subscription",
                   "model": "claude-opus-4-8", "card_id": cid, "codex_exit": "0"})
    assert routing.audit_routed_vs_ran(tmp_path, day) == []


def test_audit_ignores_cards_without_ran_model(tmp_path):
    _write_policy(tmp_path)
    _stamped_card(tmp_path, runtime="claude", model="claude-opus-4-8")
    day = datetime.date.today().isoformat()
    # No cost row for the card at all -> not a mismatch (advisory, not completeness).
    assert routing.audit_routed_vs_ran(tmp_path, day) == []


def test_audit_flags_runtime_mismatch_distinctly(tmp_path):
    _write_policy(tmp_path)
    cid = _stamped_card(tmp_path, runtime="claude", model="claude-opus-4-8")
    day = datetime.date.today().isoformat()
    # Ran a codex model though routed to claude -> a RUNTIME mismatch.
    ledger.append(tmp_path, "cost", "codex-worker",
                  {"usd": 0.0, "billing": "subscription",
                   "model": "gpt-5-codex", "card_id": cid, "codex_exit": "0"})
    mismatches = routing.audit_routed_vs_ran(tmp_path, day)
    assert len(mismatches) == 1
    assert mismatches[0].kind == "runtime"


def test_audit_is_advisory_never_raises(tmp_path):
    # No policy, no cards, no ledger — must return a list, never raise.
    assert routing.audit_routed_vs_ran(tmp_path) == []


def test_record_routing_audit_writes_activity_and_wakes_on_runtime(tmp_path):
    _write_policy(tmp_path)
    (tmp_path / "queue").mkdir(exist_ok=True)
    day = datetime.date.today().isoformat()

    runtime_mm = routing.Mismatch("c-rt", "claude", "claude-opus-4-8", "gpt-5-codex", "runtime")
    model_mm = routing.Mismatch("c-md", "claude", "claude-opus-4-8", "claude-sonnet-5", "model")

    routing.record_routing_audit(tmp_path, "auditor", runtime_mm)
    routing.record_routing_audit(tmp_path, "auditor", model_mm)

    activity = ledger.read_day(tmp_path, "activity", day)
    assert len(activity) == 2  # both kinds get an advisory activity row

    wakes = [cards.parse(p) for p in (tmp_path / "queue").glob("*/*.md")
             if cards.parse(p).meta.get("action") == routing.ROUTED_VS_RAN_ACTION]
    assert len(wakes) == 1  # only the RUNTIME mismatch files a wake-me
    assert "c-rt" in wakes[0].meta["target"]
