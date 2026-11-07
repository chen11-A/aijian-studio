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


def forecast_registration(*, creator_prompt="原始蓝外套定妆", marker_index=0):
    base = registration(_byte_image("fixed-user-reference")).model_dump()
    target = base["targets"][0]
    marker = f"https://aivora-planned.invalid/internal-{marker_index}.png"
    projected = target["body"].copy()
    projected["shots"] = [
        {
            **target["body"]["shots"][0],
            "prompt": "画面使用<IMAGE_1>中的角色",
            "references": [marker],
        }
    ]
    target["forecast"] = {
        "body": projected,
        "client_frame": {
            **target["client_frame"],
            "prompt": "角色定妆到位后的真实首帧创作请求",
            "references": [marker, target["client_frame"]["references"][0]],
        },
        "sources": [
            {
                "source": marker,
                "identity": {
                    "plannedImage": {
                        "model": "grok-imagine-image-2.0",
                        "prompt": creator_prompt,
                        "aspectRatio": "9:16",
                        "references": [],
                    }
                },
            }
        ],
    }
    return base


def test_planned_reference_recipe_uses_original_creator_not_random_marker_or_local_ids(tmp_path):
    repo, _ = _project(tmp_path)
    payload = RegisterPreparedExecution.model_validate(forecast_registration())
    expected = original_prepared_recipes(repo, toolchain, payload)[0].recipe
    assert expected["image_prompt"] == "角色定妆到位后的真实首帧创作请求"
    assert expected["image_references"][0]["plannedImage"]["prompt"] == "原始蓝外套定妆"
    assert expected["video_references"][0] == expected["image_references"][0]
    assert "aivora-planned.invalid" not in str(expected)
    alternate = forecast_registration(marker_index=21)
    alternate["key"] = "different-group-mode-versions"
    alternate["targets"][0]["key"] = "copied-shot-id"
    alternate["targets"][0]["versions"] = 3
    assert (
        original_prepared_recipes(
            repo, toolchain, RegisterPreparedExecution.model_validate(alternate)
        )[0].recipe
        == expected
    )
    changed = RegisterPreparedExecution.model_validate(
        forecast_registration(creator_prompt="用户真正改成黄色雨衣")
    )
    assert original_prepared_recipes(repo, toolchain, changed)[0].recipe != expected
    # Unconsumed global portrait stages cannot introduce another target failure bucket.
    alternate["stages"] = [
        {
            "key": "unrelated-global-person",
            "kind": "portrait",
            "target_id": "unused-person",
            "view": "正面",
            "origin": {"prompt": "任意未消费人物的创作变化", "references": []},
            "target_keys": [alternate["targets"][0]["key"]],
        }
    ]
    assert (
        original_prepared_recipes(
            repo, toolchain, RegisterPreparedExecution.model_validate(alternate)
        )[0].recipe
        == expected
    )


@pytest.mark.parametrize("change", ["missing-marker", "unused-marker", "real-bytes"])
def test_forecast_does_not_authorize_missing_or_unverified_actual_references(tmp_path, change):
    repo, _ = _project(tmp_path)
    value = forecast_registration()
    if change == "missing-marker":
        value["targets"][0]["forecast"]["sources"] = []
        with pytest.raises(ValueError):
            RegisterPreparedExecution.model_validate(value)
        return
    if change == "unused-marker":
        source = value["targets"][0]["forecast"]["sources"][0]
        value["targets"][0]["forecast"]["sources"].append(
            {**source, "source": "https://aivora-planned.invalid/internal-2.png"}
        )
    else:
        value["targets"][0]["sources"][0]["sha256"] = "f" * 64
    with pytest.raises(GenerationFailureError, match="INPUT_UNVERIFIABLE"):
        original_prepared_recipes(repo, toolchain, RegisterPreparedExecution.model_validate(value))


@pytest.mark.parametrize("shape", ["deep", "unknown", "path", "unsupported-model"])
def test_forecast_creator_graph_is_closed_and_bounded(shape):
    value = forecast_registration()
    identity = value["targets"][0]["forecast"]["sources"][0]["identity"]
    creator = identity["plannedImage"]
    if shape == "deep":
        for _ in range(10):
            nested = {"plannedImage": {**creator, "references": []}}
            creator["references"] = [nested]
            creator = nested["plannedImage"]
    elif shape == "unknown":
        creator["success"] = True
    elif shape == "path":
        identity["canonical_path"] = "/not-a-portable-or-trusted-proof"
    else:
        creator["model"] = "arbitrary-provider"
    with pytest.raises(ValueError):
        RegisterPreparedExecution.model_validate(value)
