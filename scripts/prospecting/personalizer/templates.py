from dataclasses import dataclass
from pathlib import Path
from string import Formatter
from types import MappingProxyType
from typing import Mapping


ACTIVE_INTENTS = frozenset({"networking", "recruiting_live", "curiosity", "alumni"})


class TemplateError(ValueError):
    pass


@dataclass(frozen=True)
class Template:
    template_id: str
    template_version: int
    intent: str
    subject: str
    body: str


def load_template(path: Path) -> Template:
    text = path.read_text(encoding="utf-8")
    header, marker, body = text.partition("\nbody:\n")
    if not marker:
        raise TemplateError("missing_body_marker")
    values: dict[str, str] = {}
    for line in header.splitlines():
        key, separator, value = line.partition(":")
        if not separator or key not in {"template_id", "template_version", "intent", "subject"}:
            raise TemplateError("invalid_header")
        if key in values:
            raise TemplateError("duplicate_header")
        values[key] = value.strip()
    if set(values) != {"template_id", "template_version", "intent", "subject"}:
        raise TemplateError("incomplete_header")
    if values["intent"] not in ACTIVE_INTENTS:
        raise TemplateError("inactive_intent")
    template = Template(
        values["template_id"], int(values["template_version"]), values["intent"],
        values["subject"], body.rstrip() + "\n",
    )
    if template.template_version < 1:
        raise TemplateError("invalid_version")
    slot_inventory(template)
    return template


def slot_inventory(template: Template) -> frozenset[str]:
    slots: set[str] = set()
    for text in (template.subject, template.body):
        for _, field_name, format_spec, conversion in Formatter().parse(text):
            if field_name is None:
                continue
            if not field_name.isidentifier() or format_spec or conversion:
                raise TemplateError("invalid_slot")
            slots.add(field_name)
    return frozenset(slots)


def load_registry(directory: Path) -> Mapping[str, Template]:
    templates = [load_template(path) for path in sorted(directory.glob("*.txt"))]
    registry: dict[str, Template] = {}
    for template in templates:
        if template.intent in registry:
            raise TemplateError(f"duplicate_intent:{template.intent}")
        registry[template.intent] = template
    if set(registry) != ACTIVE_INTENTS:
        raise TemplateError("active_intent_inventory_mismatch")
    return MappingProxyType(registry)


def validate_slots(template: Template, values: Mapping[str, str]) -> None:
    expected = slot_inventory(template)
    supplied = set(values)
    unknown = sorted(supplied - expected)
    missing = sorted(expected - supplied)
    if unknown:
        raise TemplateError(f"unknown_slots:{','.join(unknown)}")
    if missing:
        raise TemplateError(f"missing_slots:{','.join(missing)}")
    if any(not isinstance(value, str) or not value.strip() for value in values.values()):
        raise TemplateError("blank_slot")


def render(template: Template, values: Mapping[str, str]) -> tuple[str, str]:
    validate_slots(template, values)
    return template.subject.format_map(values), template.body.format_map(values)
