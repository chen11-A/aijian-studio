"""Original recipe plus the actually consumed client frame, not execution/UI identifiers."""

import pytest
from aijian_api.generation_dispatch_identity import story_reference_identity
from aijian_api.generation_failure_store import GenerationFailureError
from aijian_api.prepared_generation_routes import (
    RegisterPreparedExecution,
    original_prepared_recipes,
)
from test_draft_export_runtime import toolchain
from test_story_film import _byte_image, _project


def registration(reference, *, key="first", image_model="unused-api-image-model"):
    return RegisterPreparedExecution.model_validate(
        {
            "key": key,
            "targets": [
                {
                    "key": "local-shot-id",
                    "versions": 1,
                    "body": {
                        "provider": "grok_subscription",
                        "scene_label": "当前镜头",
                        "narration": "你好。",
                        "image_model": image_model,
                        "shots": [{"narration": "你好。", "prompt": "原始画面"}],
                    },
                    "sources": [
                        {
                            "source": reference,
                            "sha256": story_reference_identity(reference)["sha256"],
                        }
                    ],
                    "client_frame": {
                        "model": "grok-imagine-image-2.0",
                        "prompt": "实际客户端首帧请求",
                        "aspect_ratio": "9:16",
                        "references": [reference],
                    },
                }
            ],
            "stages": [],
        }
    )


def test_actual_client_reference_changes_recipe_but_unused_api_model_and_execution_do_not(tmp_path):
    repo, _ = _project(tmp_path)
    original = registration(_byte_image("original"))
    first = original_prepared_recipes(repo, toolchain, original)[0]
    repeated = registration(
        _byte_image("original"), key="new-execution", image_model="another-unused"
    )
    repeated.targets[0].key = "copied-local-id"
    repeated.targets[0].versions = 3
    assert original_prepared_recipes(repo, toolchain, repeated)[0].recipe == first.recipe
    changed = registration(_byte_image("user-replaced"))
    other = original_prepared_recipes(repo, toolchain, changed)[0]
    assert first.recipe["image_prompt"] == "实际客户端首帧请求"
    assert first.recipe["image_model"] == "grok-imagine-image-2.0"
    assert first.recipe["image_references"] != other.recipe["image_references"]
    assert first.recipe["video_prompt"] == other.recipe["video_prompt"]


def test_client_frame_is_not_added_to_a_user_fixed_frame_or_unverified_source(tmp_path):
    repo, _ = _project(tmp_path)
    request = registration(_byte_image("original"))
    request.targets[0].body.shots[0].still = _byte_image("user-fixed")
    request.targets[0].sources.append(
        type(request.targets[0].sources[0])(
            source=request.targets[0].body.shots[0].still,
            sha256=story_reference_identity(request.targets[0].body.shots[0].still)["sha256"],
        )
    )
    with pytest.raises(GenerationFailureError, match="INPUT_UNVERIFIABLE"):
        original_prepared_recipes(repo, toolchain, request)
    request = registration(_byte_image("original"))
    request.targets[0].sources[0].sha256 = "f" * 64
    with pytest.raises(GenerationFailureError, match="INPUT_UNVERIFIABLE"):
        original_prepared_recipes(repo, toolchain, request)
