"""Export the authoritative FastAPI OpenAPI document deterministically."""

import argparse
import json
import sys
from importlib import import_module
from pathlib import Path
from typing import get_args

from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api" / "src"))

OUTPUT = ROOT / "packages" / "contracts" / "openapi.json"
SOURCE_MANIFEST_REVIEW_MODEL_NAMES = (
    "EmptyActionRequest",
    "ConfirmationRequest",
    "PrepareGateDecisionRequest",
    "GateDecisionRequest",
    "PreparedReviewActionResponse",
    "ReviewSubmissionResponse",
    "ReviewSignoffResponse",
    "GateDecisionResponse",
)


def _write_schema(output: Path, schema: object) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def _source_manifest_review_output() -> Path:
    return ROOT / "apps" / "desktop" / "src" / "source-manifest-review.openapi.json"


def _source_manifest_review_openapi() -> dict[str, object]:
    contracts = import_module("aijian_api.contracts")
    models: list[type[BaseModel]] = []
    for name in SOURCE_MANIFEST_REVIEW_MODEL_NAMES:
        model = getattr(contracts, name)
        if not isinstance(model, type) or not issubclass(model, BaseModel):
            raise ValueError(f"source manifest review schema model is invalid: {name}")
        models.append(model)
    _ensure_reachable_model_names_are_unique(models)
    json_schema_module = import_module("pydantic.json_schema")
    _schemas, schema = json_schema_module.models_json_schema(
        [(model, "validation") for model in models],
        ref_template="#/components/schemas/{model}",
    )
    components = schema.get("$defs")
    if not isinstance(components, dict):
        raise ValueError("source manifest review schema components are missing")
    missing = set(SOURCE_MANIFEST_REVIEW_MODEL_NAMES) - set(components)
    if missing:
        raise ValueError(f"source manifest review schema components are missing: {sorted(missing)}")
    _ensure_references_are_closed(components, components)
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "Source Manifest Review Contracts",
            "version": "1.0.0",
        },
        "paths": {},
        "components": {"schemas": components},
    }


def _ensure_references_are_closed(value: object, components: dict[str, object]) -> None:
    if isinstance(value, dict):
        reference = value.get("$ref")
        if isinstance(reference, str):
            prefix = "#/components/schemas/"
            if not reference.startswith(prefix) or reference.removeprefix(prefix) not in components:
                raise ValueError(f"unresolved source manifest review schema reference: {reference}")
        for nested_value in value.values():
            _ensure_references_are_closed(nested_value, components)
    elif isinstance(value, list):
        for nested_value in value:
            _ensure_references_are_closed(nested_value, components)


def _ensure_reachable_model_names_are_unique(models: list[type[BaseModel]]) -> None:
    models_by_name: dict[str, type[BaseModel]] = {}
    visited_model_ids: set[int] = set()
    pending = list(models)
    while pending:
        model = pending.pop()
        if id(model) in visited_model_ids:
            continue
        visited_model_ids.add(id(model))
        existing = models_by_name.setdefault(model.__name__, model)
        if existing is not model:
            raise ValueError(f"conflicting source manifest review schema name: {model.__name__}")
        for field in model.model_fields.values():
            pending.extend(_nested_models(field.annotation))


def _nested_models(annotation: object) -> list[type[BaseModel]]:
    models: list[type[BaseModel]] = []
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        models.append(annotation)
    for argument in get_args(annotation):
        models.extend(_nested_models(argument))
    return models


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-manifest-review", action="store_true")
    arguments = parser.parse_args()
    if arguments.source_manifest_review:
        _write_schema(_source_manifest_review_output(), _source_manifest_review_openapi())
        return
    create_app = import_module("aijian_api.main").create_app
    sidecar_security_type = import_module("aijian_api.security").SidecarSecurity
    contract_sidecar = sidecar_security_type(
        token="contract-export-token-without-runtime-authority",
        host="127.0.0.1:43127",
        origin="app://aijian",
    )
    _write_schema(OUTPUT, create_app(sidecar_security=contract_sidecar).openapi())


if __name__ == "__main__":
    main()
