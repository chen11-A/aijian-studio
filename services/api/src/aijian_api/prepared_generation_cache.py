"""Actual per-slot cache observation, before any automatic image or video dispatch."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

from aijian_api.generation_dispatch_identity import story_reference_identity
from aijian_api.generation_failure_store import GenerationFailureError
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.prepared_generation_store import (
    PreparedCacheChoice,
    PreparedCacheTarget,
    PreparedGenerationStore,
)
from aijian_api.repository import StudioRepository
from aijian_api.story_creation_cache import StoryCreationCache, StoryCreationCacheError
from aijian_api.story_film import StoryFilmService, story_shot_request
from aijian_api.story_film_routes import CreateStoryFilmBody, story_film_request
from aijian_api.xai_media import IMAGE_MODEL, XaiImage, _image_reference


def same(left: object, right: object) -> bool:
    return json.dumps(left, sort_keys=True, ensure_ascii=False, allow_nan=False) == json.dumps(
        right, sort_keys=True, ensure_ascii=False, allow_nan=False
    )


def byte_identity(value: object) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"sha256", "mime"}
        and isinstance(value["sha256"], str)
        and len(value["sha256"]) == 64
        and all(character in "0123456789abcdef" for character in value["sha256"])
        and isinstance(value["mime"], str)
        and value["mime"] in {"image/png", "image/jpeg", "image/webp"}
    )


class PreparedGenerationCache:
    def __init__(self, repository: StudioRepository, tools: Callable[[], MediaToolchain]) -> None:
        self.repository = repository
        self.tools = tools
        self.store = PreparedGenerationStore(repository)

    def cache(self, project: str, target: PreparedCacheTarget) -> StoryCreationCache:
        return StoryCreationCache(
            Path(self.repository.database_path).parent / "story-films",
            project,
            target.recipe,
            Path(self.repository.database_path),
        )

    def _reference_matches(
        self,
        project: str,
        account: str,
        expected: object,
        actual: object,
    ) -> bool:
        if not byte_identity(actual):
            return False
        assert isinstance(actual, dict)
        if byte_identity(expected):
            return same(expected, actual)
        if not isinstance(expected, dict) or set(expected) != {"plannedImage"}:
            return False
        creator = expected["plannedImage"]
        if not isinstance(creator, dict) or set(creator) != {
            "model",
            "prompt",
            "aspectRatio",
            "references",
        }:
            return False
        from aijian_api.prepared_generation_routes import canonical_stage_fact

        for fact in self.store.lineages(
            project, account=account, output_sha256s=(actual["sha256"],)
        ):
            stage = canonical_stage_fact(fact["stage"])
            origin = stage["origin"]
            assert isinstance(origin, dict)
            if (
                fact["output_sha256"] == actual["sha256"]
                and origin.get("imageModel") == creator["model"]
                and origin.get("prompt") == creator["prompt"]
                and origin.get("aspectRatio") == creator["aspectRatio"]
                and same(origin.get("references"), creator["references"])
            ):
                return True
        return False

    def _verify_runtime(
        self,
        project: str,
        account: str,
        target: PreparedCacheTarget,
        snapshot: dict[str, object],
        bundle: tuple[bytes, bytes, bytes],
    ) -> None:
        runtime = snapshot["runtime_recipe"]
        assert isinstance(runtime, dict)
        goal = target.recipe
        for field in (
            "video_prompt",
            "video_model",
            "requested_seconds",
            "cap",
            "resolution",
            "aspect_ratio",
            "speech",
            "speech_window",
        ):
            if not same(runtime.get(field), goal.get(field)):
                raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
        actual = runtime["actual_video"]
        assert isinstance(actual, dict)
        image = story_reference_identity(
            _image_reference(XaiImage(data=bundle[0], source_url=None, model=IMAGE_MODEL))["url"]
        )
        if not same(actual["image"], image) or not same(runtime["prepared_image"], image):
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
        if type(goal.get("cap")) is not int or not actual["seconds"] <= goal["cap"]:
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
        expected_image = goal.get("prepared_image")
        if expected_image is None:
            expected_image = {
                "plannedImage": {
                    "model": goal.get("image_model"),
                    "prompt": goal.get("image_prompt"),
                    "aspectRatio": goal.get("aspect_ratio"),
                    "references": goal.get("image_references"),
                }
            }
        if not self._reference_matches(project, account, expected_image, image):
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
        expected, actual_refs = goal.get("video_references"), runtime.get("video_references")
        if (
            not isinstance(expected, list)
            or not isinstance(actual_refs, list)
            or len(expected) != len(actual_refs)
        ):
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
        if not all(
            self._reference_matches(project, account, wanted, value)
            for wanted, value in zip(expected, actual_refs, strict=True)
        ):
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE")

    def prepare(
        self,
        project: str,
        execution: str,
        account: str,
        sources: dict[str, tuple[dict[str, object], ...]],
    ) -> tuple[PreparedCacheChoice, ...]:
        """No provider request, no policy reservation, no fallback after a failed read."""
        targets = self.store.preparation_targets(project, execution, account=account)
        existing = self.store.preparations(project, execution, account=account)
        if existing is not None:
            # An immutable prior table is not recomputed against a newer bundle.json.
            for choice in existing:
                if choice.preparation == "STORYFILM_CACHE":
                    target = next(row for row in targets if row.key == choice.target_key)
                    if choice.request != target.request or choice.sources != sources[target.key]:
                        raise GenerationFailureError("INPUT_UNVERIFIABLE")
                    self.cache(project, target).read_snapshot(choice.snapshot)
            return existing
        choices = []
        verifier = StoryFilmService(self.repository, self.tools)
        for target in targets:
            snapshot = None
            if not target.first_regenerate:
                cache = self.cache(project, target)
                snapshot = cache.preparation_snapshot()
                body = CreateStoryFilmBody.model_validate(target.request)
                request = story_film_request(body, "cache-observation")
                if len(request.shots) != 1:
                    raise GenerationFailureError("INPUT_UNVERIFIABLE")
                child = story_shot_request(request, request.shots[0], 1)
                if snapshot is not None:
                    bundle = cache.read_snapshot(snapshot)
                    self._verify_runtime(project, account, target, snapshot, bundle)
                    cap = target.recipe.get("cap")
                    if type(cap) is not int or cap not in {10, 15}:
                        raise GenerationFailureError("INPUT_UNVERIFIABLE")
                    verifier.validate_cached_bundle(child, project, bundle, cap, strict=True)
                    # Observe the same complete immutable files after tool awaits.
                    cache.read_snapshot(snapshot)
                elif verifier._find_saved_image(project, child) is not None:
                    raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
            for slot in range(target.versions):
                choices.append(
                    PreparedCacheChoice(
                        target.key,
                        slot,
                        "STORYFILM_CACHE"
                        if snapshot is not None and slot == 0
                        else "CLIENT_IMAGES",
                        snapshot if slot == 0 else None,
                        target.request if snapshot is not None and slot == 0 else None,
                        sources[target.key] if snapshot is not None and slot == 0 else (),
                    )
                )
        return self.store.freeze_preparations(
            project,
            execution,
            account=account,
            choices=tuple(choices),
        )
