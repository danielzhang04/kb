"""Model/tool routing resolver — Phase R1 (docs/plans/2026-07-17-phase-r-model-routing.md).

Pure, side-effect-free precedence resolution of a card to exactly one
``(runtime, model)`` pair, with recorded per-field provenance. The one-winner
precedence (proposal §4, normative):

    card frontmatter > queue/routing-override.yaml > governance/model-routing.yaml
        > built-in safe default (claude / claude-sonnet-5)

evaluated top-down, field-by-field for ``runtime`` and ``model`` independently.
Within the override file a ``scope: card`` entry (key == card id) outranks a
``scope: agent`` entry (key == card owner); same scope+key -> last wins; an
entry at/after its ``expires`` is treated as absent.

Failure posture (ordering-law 3):
  * An unknown *named* model (resolved concrete id not in the runtime's
    ``known_models``) fails **LOUD** -> ``RoutingError`` (never silently
    substituted; dispatch converts it to a wake-me:unroutable-card and skips).
  * A corrupt/missing **policy** or **override** file fails **OPEN**: the loader
    returns a conservative default and logs a WARN; dispatch never stalls.

``load_policy``/``load_override`` mirror ``preamble._daily_limit``'s pattern:
``path.exists()`` guard, ``yaml.safe_load``, ``try/except`` -> safe default +
``logging.warning``. ``resolve`` performs no I/O and mutates nothing — the
dispatcher loads the two files once per run and passes them in.
"""
from __future__ import annotations

import datetime
import logging
from pathlib import Path
from typing import NamedTuple

import yaml

import ledger

log = logging.getLogger(__name__)

# The hard-coded fallback reached ONLY when the whole policy file is unreadable
# (proposal §4 rung 4). It is deliberately the safe, cheap, always-available
# runtime+model so dispatch never stalls for lack of a route.
SAFE_DEFAULT: tuple[str, str] = ("claude", "claude-sonnet-5")

# The escalation ladder over the model-routing ALIAS vocabulary — cheapest first,
# strongest last. This is the SINGLE definition of tier order in the codebase; the
# alias *names* (haiku/sonnet/opus) and their concrete model ids both come from the
# runtime's `aliases` table in governance/model-routing.yaml (see the `claude` block
# there), so `escalate_model` reuses that policy table rather than hardcoding a
# parallel model map. Wave F escalation-on-failure (dispatch.requeue) walks a card
# one rung UP this ladder on each failed attempt. A runtime whose model is not on
# this ladder (e.g. the single-tier `codex` runtime) is treated as already-top: no
# bump. Adding a tier means editing this tuple AND the policy's aliases — nowhere else.
TIER_LADDER: tuple[str, ...] = ("haiku", "sonnet", "opus")

# Ledger action names for the routed-vs-ran audit (R1.4).
ROUTED_VS_RAN_ACTION = "wake-me:routed-vs-ran"


class RoutingError(Exception):
    """Raised when a resolved ``(runtime, model)`` names a model the runtime does
    not know (proposal §4 unknown-model guard). Fail-loud, never substitute."""


class Routed(NamedTuple):
    """The single resolved routing decision with per-field provenance.

    ``source_runtime`` / ``source_model`` each ∈ {"card", "override", "policy",
    "default"} — the rung of the precedence chain that supplied that field."""
    runtime: str
    model: str
    source_runtime: str
    source_model: str


class Mismatch(NamedTuple):
    """One routed-vs-ran divergence found by ``audit_routed_vs_ran`` (R1.4).

    ``kind`` is "runtime" (routed runtime != the runtime that actually ran — the
    load-bearing divergence that also files a wake-me) or "model" (a mere
    model-id drift within the same runtime — advisory only)."""
    card_id: str
    routed_runtime: str | None
    routed_model: str | None
    ran_model: str
    kind: str


# --------------------------------------------------------------------------- #
# Loaders — budget.yaml pattern: exists-guard, safe_load, safe default on any  #
# failure + WARN. NEVER raise (a load failure must not crash dispatch).        #
# --------------------------------------------------------------------------- #
def load_policy(repo_root: Path) -> dict:
    """Read ``governance/model-routing.yaml``.

    Returns the parsed mapping, or ``{}`` when the file is absent / empty /
    malformed (logged). An empty policy makes ``resolve`` fall through to the
    built-in ``SAFE_DEFAULT`` (source "default") — the file does not exist yet
    (Daniel commits it at gate R1.0), so this must behave correctly both ways.
    """
    f = Path(repo_root) / "governance" / "model-routing.yaml"
    if not f.exists():
        return {}
    try:
        data = yaml.safe_load(f.read_text(encoding="utf-8"))
    except Exception as err:  # noqa: BLE001 — fail open to safe default, never crash dispatch
        log.warning("model-routing.yaml unreadable (%s); falling back to safe default", err)
        return {}
    if not isinstance(data, dict):
        log.warning("model-routing.yaml is not a mapping; falling back to safe default")
        return {}
    return data


def load_override(repo_root: Path) -> dict:
    """Read ``queue/routing-override.yaml``.

    Returns ``{"overrides": [...]}``, or ``{"overrides": []}`` when the file is
    absent / empty / malformed / schema-invalid (logged) — fail OPEN to policy.
    A corrupt override must never freeze or misroute the fleet.
    """
    empty = {"overrides": []}
    f = Path(repo_root) / "queue" / "routing-override.yaml"
    if not f.exists():
        return empty
    try:
        data = yaml.safe_load(f.read_text(encoding="utf-8"))
    except Exception as err:  # noqa: BLE001 — fail open to policy, never crash dispatch
        log.warning("routing-override.yaml unparseable (%s); ignoring all overrides", err)
        return empty
    if not isinstance(data, dict) or not isinstance(data.get("overrides"), list):
        log.warning("routing-override.yaml schema-invalid; ignoring all overrides")
        return empty
    return data


# --------------------------------------------------------------------------- #
# Resolver internals                                                           #
# --------------------------------------------------------------------------- #
def _parse_iso(value: str) -> datetime.datetime:
    """Parse an ISO-8601 timestamp, normalising a trailing ``Z`` to +00:00 and
    treating a naive timestamp as UTC (so comparison against ``now`` is total)."""
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt


def _expired(entry: dict, now: datetime.datetime) -> bool:
    """True iff the entry is at/after its ``expires`` (or has an unparseable
    ``expires`` — treated as absent, which is fail-open to policy)."""
    exp = entry.get("expires")
    if not exp:  # None / "" / missing => no expiry
        return False
    try:
        return _parse_iso(str(exp)) <= now
    except (ValueError, TypeError):
        log.warning("routing-override entry has unparseable expires=%r; ignoring entry", exp)
        return True


def _select_override_entry(override: dict, card_meta: dict) -> dict | None:
    """The single winning override entry for this card, or None.

    A non-expired ``scope: card`` entry whose ``key == card.id`` outranks a
    non-expired ``scope: agent`` entry whose ``key == card.owner``. Within one
    scope+key the LAST matching entry in file order wins (the dashboard appends;
    a "clear" removes the entry)."""
    entries = (override or {}).get("overrides") or []
    card_id = card_meta.get("id")
    owner = card_meta.get("owner")
    now = datetime.datetime.now(datetime.timezone.utc)
    card_match: dict | None = None
    agent_match: dict | None = None
    for entry in entries:
        if not isinstance(entry, dict) or _expired(entry, now):
            continue
        scope = entry.get("scope")
        key = entry.get("key")
        if scope == "card" and card_id is not None and key == card_id:
            card_match = entry  # last wins
        elif scope == "agent" and owner is not None and key == owner:
            agent_match = entry  # last wins
    return card_match or agent_match


def _policy_entry(policy: dict, role: str, tier: str) -> dict | None:
    """policy[role][tier] -> policy[role]["*"] -> role_default, or None.

    Returns a ``{runtime, model}`` mapping where ``model`` may be an alias
    (resolved later through the runtime registry). None means the policy file is
    empty/unusable for this role — resolve then falls to the safe default."""
    if not policy:
        return None
    matrix = policy.get("policy") or {}
    role_map = matrix.get(role)
    if isinstance(role_map, dict):
        entry = role_map.get(tier)
        if entry is None:
            entry = role_map.get("*")
        if isinstance(entry, dict):
            return entry
    role_default = policy.get("role_default")
    if isinstance(role_default, dict):
        return role_default
    return None


def _resolve_alias(policy: dict, runtime: str, model_or_alias: str) -> str:
    """Map a policy tier-alias (opus/sonnet/haiku/codex) to the concrete model id
    via ``runtimes[runtime].aliases``. A concrete id (not an alias key) passes
    through unchanged — alias keys and published model ids never collide."""
    runtimes = (policy or {}).get("runtimes") or {}
    aliases = (runtimes.get(runtime) or {}).get("aliases") or {}
    return aliases.get(model_or_alias, model_or_alias)


def escalate_model(policy: dict, runtime: str, model: str) -> tuple[str, bool]:
    """Bump ``model`` one rung UP its runtime's alias ladder (Wave F escalation).

    Returns ``(new_model, bumped)``. The concrete-id <-> alias mapping comes wholly
    from ``runtimes[runtime].aliases`` in the policy (the same table ``resolve``'s
    ``_resolve_alias`` reads) intersected with the ordered ``TIER_LADDER`` — there
    is no parallel model table here. ``bumped`` is False (and ``model`` returned
    unchanged) whenever a bump is impossible:
      * an empty/absent policy (no alias table to read),
      * a ``model`` that is not one of this runtime's laddered aliases (e.g. a
        single-tier ``codex`` model, or an unknown id),
      * a ``model`` already at the TOP tier of the ladder.
    So a top-tier card, a codex card, and a policy-less card all "retry the same
    tier" — the caller still counts the attempt against the retry cap.
    """
    if not model:
        return model, False
    runtimes = (policy or {}).get("runtimes") or {}
    aliases = (runtimes.get(runtime) or {}).get("aliases") or {}
    # Reverse the alias table: concrete model id -> alias tier name.
    # If two aliases ever point at ONE concrete id, this reverse map keeps the
    # LAST one in table order — i.e. the higher tier under the canonical
    # haiku<sonnet<opus YAML ordering, so escalation degrades to no-bump rather
    # than a spurious bump. Keep alias->id mappings distinct in
    # governance/model-routing.yaml regardless.
    alias_of = {concrete: alias for alias, concrete in aliases.items()}
    alias = alias_of.get(model)
    if alias is None or alias not in TIER_LADDER:
        return model, False                 # not a laddered model -> no bump
    idx = TIER_LADDER.index(alias)
    if idx >= len(TIER_LADDER) - 1:
        return model, False                 # already the strongest tier -> no bump
    next_alias = TIER_LADDER[idx + 1]
    next_model = aliases.get(next_alias)
    if not next_model:
        return model, False                 # ladder tier missing a concrete id -> no bump
    return str(next_model), True


def _known_models(policy: dict, runtime: str) -> list | None:
    """The runtime's ``known_models`` list, or None when the runtime is not in
    the registry (empty policy, or an unregistered runtime) — in which case the
    unknown-model guard cannot run and we fail open (trust the value)."""
    runtimes = (policy or {}).get("runtimes") or {}
    rt = runtimes.get(runtime)
    if not isinstance(rt, dict):
        return None
    known = rt.get("known_models")
    return known if isinstance(known, list) else None


def default_worker_for(policy: dict, runtime: str) -> str | None:
    """The owner id dispatch claims a card as when a cadence does not pin
    ``agent:`` — ``runtimes[runtime].default_worker`` (each such id is one a
    runner is bound to). None when the runtime is not registered (e.g. policy
    absent) — dispatch then keeps the dispatcher itself as owner."""
    runtimes = (policy or {}).get("runtimes") or {}
    rt = runtimes.get(runtime)
    if isinstance(rt, dict):
        worker = rt.get("default_worker")
        if worker:
            return str(worker)
    return None


def runtime_of_worker(policy: dict, worker: str) -> str | None:
    """Reverse lookup: the runtime whose ``default_worker == worker``, or None.

    Used by dispatch to cross-check a cadence-pinned ``agent:`` against the
    resolved runtime (an unknown worker -> None -> no cross-check, never a
    false mismatch)."""
    runtimes = (policy or {}).get("runtimes") or {}
    for name, rt in runtimes.items():
        if isinstance(rt, dict) and rt.get("default_worker") == worker:
            return str(name)
    return None


def resolve(card_meta: dict, role: str, tier: str, policy: dict, override: dict) -> Routed:
    """Resolve a card to exactly one ``(runtime, model)`` with provenance.

    Pure: no I/O, no ledger, no card mutation. ``runtime`` and ``model`` are
    each resolved independently down the precedence chain (card > override >
    policy > safe default); the winning rung is recorded per field. After
    composing the winner, the concrete model is verified against the runtime's
    ``known_models`` (when the runtime is registered) and an unknown model
    raises ``RoutingError`` — never a silent substitution.
    """
    runtime_val: str | None = None
    runtime_src: str | None = None
    model_val: str | None = None
    model_src: str | None = None
    model_is_alias = False  # only a policy-supplied model is an alias to resolve

    # Rung 1 — card frontmatter (highest authority; a human pinned this card).
    if card_meta.get("runtime"):
        runtime_val, runtime_src = str(card_meta["runtime"]), "card"
    if card_meta.get("model"):
        model_val, model_src = str(card_meta["model"]), "card"

    # Rung 2 — the single winning override entry (card-scope beats agent-scope).
    entry = _select_override_entry(override, card_meta)
    if entry:
        if runtime_val is None and entry.get("runtime"):
            runtime_val, runtime_src = str(entry["runtime"]), "override"
        if model_val is None and entry.get("model"):
            model_val, model_src = str(entry["model"]), "override"

    # Rung 3 — policy[role][tier] -> [role]["*"] -> role_default.
    pol = _policy_entry(policy, role, tier)
    if pol:
        if runtime_val is None and pol.get("runtime"):
            runtime_val, runtime_src = str(pol["runtime"]), "policy"
        if model_val is None and pol.get("model"):
            model_val, model_src = str(pol["model"]), "policy"
            model_is_alias = True

    # Rung 4 — built-in safe default (only reached when a field is still unset).
    if runtime_val is None:
        runtime_val, runtime_src = SAFE_DEFAULT[0], "default"
    if model_val is None:
        model_val, model_src = SAFE_DEFAULT[1], "default"

    # Resolve a policy alias against the FINAL runtime; concrete ids pass through.
    if model_is_alias:
        model_val = _resolve_alias(policy, runtime_val, model_val)

    # Unknown-model guard (fail loud). Skipped only when the runtime is not in
    # the registry (policy absent/unregistered) — then we cannot check, so fail
    # open and trust the value (the safe default never raises).
    known = _known_models(policy, runtime_val)
    if known is not None and model_val not in known:
        raise RoutingError(
            f"model {model_val!r} is not in runtime {runtime_val!r} known_models "
            f"{known!r} (source runtime={runtime_src}, model={model_src})"
        )

    return Routed(runtime_val, model_val, runtime_src, model_src)


# --------------------------------------------------------------------------- #
# R1.4 — soft routed-vs-ran audit over the existing cost-ledger `model` column #
# --------------------------------------------------------------------------- #
def _index_cards_by_id(repo_root: Path) -> dict[str, dict]:
    """Map every parseable card's id -> its meta, across the whole queue/ tree.
    Fail-open per card (skip an unparseable one) — the audit is advisory."""
    import cards  # local import: avoid a hard import cycle at module load

    out: dict[str, dict] = {}
    queue_root = Path(repo_root) / "queue"
    if not queue_root.exists():
        return out
    for path in queue_root.glob("*/*.md"):
        try:
            card = cards.parse(path)
        except Exception:  # noqa: BLE001 — advisory audit: skip an unparseable card
            continue
        cid = card.meta.get("id")
        if cid:
            out[str(cid)] = card.meta
    return out


def _runtime_of_model(policy: dict, model: str) -> str | None:
    """Which registered runtime lists ``model`` in its ``known_models``, or None."""
    runtimes = (policy or {}).get("runtimes") or {}
    for name, rt in runtimes.items():
        if isinstance(rt, dict) and model in (rt.get("known_models") or []):
            return str(name)
    return None


def audit_routed_vs_ran(repo_root: Path, day: str | None = None) -> list[Mismatch]:
    """Join the day's cost-ledger rows (the model the runtime ACTUALLY ran, keyed
    by ``card_id``) against each card's stamped ``model`` (the ROUTED intent) and
    return the divergences. Advisory: reads only, never raises, never blocks.

    A card with no cost row yet (not run) is not examined; a cost row whose
    model matches the stamped model is not a mismatch. A divergence whose ran
    model belongs to a different runtime than the card's stamped runtime is a
    ``kind="runtime"`` mismatch (load-bearing); otherwise ``kind="model"`` drift.
    """
    day = day or datetime.date.today().isoformat()
    policy = load_policy(repo_root)
    cards_by_id = _index_cards_by_id(repo_root)
    out: list[Mismatch] = []
    for row in ledger.read_day(repo_root, "cost", day):
        card_id = row.get("card_id")
        ran_model = row.get("model")
        if not card_id or not ran_model or ran_model == "unknown":
            continue
        meta = cards_by_id.get(str(card_id))
        if meta is None:
            continue
        routed_model = meta.get("model")
        if not routed_model:  # legacy card with no routed intent -> nothing to compare
            continue
        if ran_model == routed_model:
            continue
        routed_runtime = meta.get("runtime")
        ran_runtime = _runtime_of_model(policy, ran_model)
        kind = "runtime" if (routed_runtime and ran_runtime and ran_runtime != routed_runtime) else "model"
        out.append(Mismatch(str(card_id), routed_runtime, routed_model, ran_model, kind))
    return out


def record_routing_audit(repo_root: Path, agent: str, mismatch: Mismatch) -> None:
    """Emit the advisory record for one mismatch: always an ``activity`` ledger
    row; additionally, on a ``kind="runtime"`` mismatch only, a
    ``wake-me:routed-vs-ran`` card (a model-only drift is too noisy to wake on —
    the activity row is its record). Never raises."""
    import cards  # local import: avoid a hard import cycle at module load

    try:
        ledger.append(repo_root, "activity", agent, {
            "date": datetime.date.today().isoformat(),
            "event": "routed-vs-ran",
            "card_id": mismatch.card_id,
            "routed_runtime": mismatch.routed_runtime or "",
            "routed_model": mismatch.routed_model or "",
            "ran_model": mismatch.ran_model,
            "kind": mismatch.kind,
        })
    except Exception as err:  # noqa: BLE001 — advisory: a ledger hiccup must not kill a run
        log.warning("could not record routing audit for %s: %s", mismatch.card_id, err)

    if mismatch.kind != "runtime":
        return
    target = f"routed-vs-ran:{mismatch.card_id}"
    if _wake_already_filed(repo_root, ROUTED_VS_RAN_ACTION, target):
        return
    body = (
        "## Work order\n\n"
        f"Card `{mismatch.card_id}` was routed to runtime "
        f"`{mismatch.routed_runtime}` (model `{mismatch.routed_model}`) but the "
        f"cost ledger records it ran under model `{mismatch.ran_model}` — a "
        "RUNTIME mismatch, not a mere model-id drift. Investigate which runner "
        "picked up this card and why its runtime differs from the routed intent.\n"
    )
    try:
        card = cards.new_card(project="kb", action=ROUTED_VS_RAN_ACTION, target=target,
                              risk_tier="T1", body=body)
        cards.save(card, Path(repo_root) / "queue")
    except Exception as err:  # noqa: BLE001 — advisory: never kill a run on a wake-me hiccup
        log.warning("could not file routed-vs-ran wake for %s: %s", mismatch.card_id, err)


def _wake_already_filed(repo_root: Path, action: str, target: str) -> bool:
    """Dedup helper mirroring dispatch._wake_already_filed — one wake-me per
    (action, target) for as long as such a card exists anywhere in queue/."""
    import cards  # local import: avoid a hard import cycle at module load

    queue_root = Path(repo_root) / "queue"
    if not queue_root.exists():
        return False
    for path in queue_root.glob("*/*.md"):
        try:
            existing = cards.parse(path)
        except Exception:  # noqa: BLE001 — fail open: skip an unparseable card
            continue
        if existing.meta.get("action") == action and existing.meta.get("target") == target:
            return True
    return False
