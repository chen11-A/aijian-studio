"""Strict stdio entrypoint for one isolated Fake Agent/Skill invocation."""

from __future__ import annotations

import importlib
import json
import sys
from collections.abc import Callable

from pydantic import ValidationError

from aijian_api.agent_skill_contracts import ArtifactProposalV1, AttemptSnapshotV1


def _resolve_handler(module_name: str, qualname: str) -> Callable[..., ArtifactProposalV1]:
    resolved: object = importlib.import_module(module_name)
    for part in qualname.split("."):
        resolved = getattr(resolved, part)
    if not callable(resolved):
        raise TypeError("Fake Skill handler is not callable")
    return resolved


def run() -> int:
    stage = "request"
    try:
        request = json.loads(sys.stdin.read())
        if not isinstance(request, dict) or set(request) != {
            "handler_module",
            "handler_qualname",
            "snapshot",
            "invocation_index",
            "has_handler_input",
            "handler_input",
        }:
            raise ValueError("Fake Skill subprocess request is invalid")
        if (
            not isinstance(request["handler_module"], str)
            or not request["handler_module"]
            or not isinstance(request["handler_qualname"], str)
            or not request["handler_qualname"]
            or not isinstance(request["invocation_index"], int)
            or isinstance(request["invocation_index"], bool)
            or request["invocation_index"] < 0
            or not isinstance(request["has_handler_input"], bool)
        ):
            raise ValueError("Fake Skill subprocess request types are invalid")
        stage = "handler_resolve"
        handler = _resolve_handler(
            str(request["handler_module"]),
            str(request["handler_qualname"]),
        )
        stage = "snapshot"
        snapshot = AttemptSnapshotV1.model_validate(request["snapshot"])
        invocation_index = int(request["invocation_index"])
        stage = "handler"
        proposal = (
            handler(snapshot, invocation_index, request["handler_input"])
            if request["has_handler_input"] is True
            else handler(snapshot, invocation_index)
        )
        stage = "proposal"
        validated = ArtifactProposalV1.model_validate(proposal)
        response = {"kind": "proposal", "proposal": validated.model_dump(mode="json")}
    except BaseException as error:
        response = {
            "kind": "error",
            "error_class": type(error).__name__,
            "error_stage": stage,
            "error_locations": (
                [
                    f"{'.'.join(str(part) for part in item['loc'])}:{item['type']}"
                    for item in error.errors()
                ]
                if isinstance(error, ValidationError)
                else []
            ),
        }
    sys.stdout.write(
        json.dumps(
            response,
            ensure_ascii=True,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
