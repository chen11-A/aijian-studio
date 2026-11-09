"""Main-attested prerequisite facts. No route performs a provider request."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import replace
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from aijian_api.contracts import PROJECT_ID_PATTERN
from aijian_api.generation_dispatch_identity import account_attestation, story_reference_identity
from aijian_api.generation_failure_store import GenerationFailureError
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.prepared_generation_sources import (
    materialize_request,
    parse_sources,
    reference_snapshot,
)
from aijian_api.prepared_generation_store import (
    PreparedGenerationStore,
    PreparedStage,
    PreparedTarget,
)
from aijian_api.repository import StudioRepository
from aijian_api.story_film import StoryFilmError, StoryFilmService
from aijian_api.story_film_routes import CreateStoryFilmBody, story_film_request

_KEY = r"^[a-zA-Z0-9_:@.-]{1,160}$"
_SHA = r"^[a-f0-9]{64}$"


class ExpectedPreparedSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(min_length=1, max_length=4096)
    sha256: str = Field(pattern=_SHA)


class PreparedClientFrame(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: Literal["grok-imagine-image-2.0"]
    prompt: str = Field(min_length=1, max_length=2000)
    aspect_ratio: Literal["9:16", "16:9"]
    references: list[str] = Field(max_length=5)


class ForecastByteIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sha256: str = Field(pattern=_SHA)
    mime: Literal["image/png", "image/jpeg", "image/webp"]


class ForecastCreator(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: Literal["grok-imagine-image-2.0"]
    prompt: str = Field(min_length=1, max_length=2000)
    aspectRatio: Literal["9:16", "16:9"]
    references: list[ForecastByteIdentity | ForecastPlannedIdentity] = Field(max_length=13)


class ForecastPlannedIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plannedImage: ForecastCreator


class ForecastSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(pattern=r"^https://aivora-planned\.invalid/internal-[0-9]{1,4}\.png$")
    identity: ForecastPlannedIdentity


class PreparedForecast(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: CreateStoryFilmBody
    client_frame: PreparedClientFrame | None = None
    sources: list[ForecastSource] = Field(min_length=1, max_length=1024)

    @model_validator(mode="after")
    def bounded_creator_graph(self) -> PreparedForecast:
        pending: list[tuple[ForecastByteIdentity | ForecastPlannedIdentity, int]] = [
            (row.identity, 0) for row in self.sources
        ]
        count = 0
        while pending:
            value, depth = pending.pop()
            count += 1
            if count > 2048 or depth > 8:
                raise ValueError("INPUT_UNVERIFIABLE")
            if isinstance(value, ForecastPlannedIdentity):
                pending.extend((row, depth + 1) for row in value.plannedImage.references)
        if len(self.model_dump_json()) > 1024 * 1024:
            raise ValueError("INPUT_UNVERIFIABLE")
        return self


class PreparedTargetBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=_KEY)
    versions: int = Field(strict=True, ge=1, le=3)
    first_regenerate: bool = Field(default=False, strict=True)
    body: CreateStoryFilmBody
    sources: list[ExpectedPreparedSource] = Field(max_length=20)
    client_frame: PreparedClientFrame | None = None
    forecast: PreparedForecast | None = None


class PreparedStageBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=_KEY)
    kind: Literal["location-reference", "portrait", "shot-frame"]
    target_id: str = Field(min_length=1, max_length=160)
    view: Literal["正面", "侧面", "背面", "脸部"] | None = None
    origin: dict[str, Any]
    target_keys: list[str] = Field(min_length=1, max_length=256)


class RegisterPreparedExecution(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=_KEY)
    targets: list[PreparedTargetBody] = Field(min_length=1, max_length=256)
    stages: list[PreparedStageBody] = Field(max_length=1024)


class PreparedImageDispatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stage_key: str = Field(pattern=_KEY)
    body_sha256: str = Field(pattern=_SHA)


class PreparedImageObservation(PreparedImageDispatch):
    output_sha256: str | None = Field(pattern=_SHA)


class ExpectedRuntimeSource(ExpectedPreparedSource):
    role: Literal["still", "reference", "references"]
    index: int = Field(strict=True, ge=0, le=12)
    mime: Literal["image/png", "image/jpeg", "image/webp"]
    canonical_path: str | None = Field(max_length=4096)


class PreparedVideoArm(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_key: str = Field(pattern=_KEY)
    slot_index: int = Field(strict=True, ge=0, le=2)
    take_key: str = Field(pattern=_KEY)
    body_sha256: str = Field(pattern=_SHA)
    wire_body: str = Field(min_length=1, max_length=1024 * 1024)
    sources: list[ExpectedRuntimeSource] = Field(max_length=15)


class ArmedPreparedVideo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    arm_id: str = Field(pattern=r"^[a-f0-9]{32}$")


class PrepareCacheSlots(BaseModel):
    model_config = ConfigDict(extra="forbid")
    registration: RegisterPreparedExecution


class PreparedCachePart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sha256: str = Field(pattern=_SHA)
    bytes: int = Field(strict=True, ge=1, le=80 * 1024 * 1024)


class PreparedPrivateCache(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    snapshot_sha256: str = Field(pattern=_SHA)
    input_sha256: str = Field(pattern=_SHA)
    request: CreateStoryFilmBody
    sources: list[dict[str, Any]]
    runtime_recipe: dict[str, Any]
    parts: dict[Literal["image", "video", "voice"], PreparedCachePart]


class PreparedSlotCacheFact(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_key: str = Field(pattern=_KEY)
    slot_index: int = Field(strict=True, ge=0, le=2)
    preparation: Literal["CLIENT_IMAGES", "STORYFILM_CACHE"]
    cache: PreparedPrivateCache | None = None


class PreparedSlotCacheFacts(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["PREPARATIONS"] = "PREPARATIONS"
    items: list[PreparedSlotCacheFact] = Field(min_length=1, max_length=768)


class PreparedRetirement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_key: str | None = Field(default=None, pattern=_KEY)
    slot_index: int | None = Field(default=None, strict=True, ge=0, le=2)


class PreparedLineageQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    output_sha256s: list[str] = Field(min_length=1, max_length=256)


class PreparedLineageFacts(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[dict[str, Any]]


class RegisteredPreparedExecution(BaseModel):
    model_config = ConfigDict(extra="forbid")
    execution_id: str = Field(pattern=r"^[a-f0-9]{32}$")


class RecordedPreparedFact(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["RECORDED"] = "RECORDED"


def canonical_stage_fact(value: object) -> dict[str, object]:
    """Normalize only the historical typed nonportrait/view:null encoding.

    Preserve the stored evidence and origin verbatim. Unknown keys, non-null views
    on nonportraits or missing portrait views are not repaired into valid proof.
    """
    required = {"kind", "target_id", "origin"}
    if (
        not isinstance(value, dict)
        or set(value) not in (required, required | {"view"})
        or not isinstance(value.get("kind"), str)
        or value["kind"] not in {"shot-frame", "location-reference", "portrait"}
        or not isinstance(value.get("target_id"), str)
        or not 1 <= len(value["target_id"]) <= 160
        or not isinstance(value.get("origin"), dict)
    ):
        raise GenerationFailureError("INPUT_UNVERIFIABLE")
    result = dict(value)
    if value["kind"] == "portrait":
        if not isinstance(value.get("view"), str) or value["view"] not in {
            "正面",
            "侧面",
            "背面",
            "脸部",
        }:
            raise GenerationFailureError("INPUT_UNVERIFIABLE")
    else:
        if value.get("view") is not None:
            raise GenerationFailureError("INPUT_UNVERIFIABLE")
        result.pop("view", None)
    return result


def bounded_reference(source: str) -> str | None:
    try:
        return reference_snapshot(source)[0]
    except ValueError:
        return None


def original_prepared_recipes(
    repository: StudioRepository,
    tools: Callable[[], MediaToolchain],
    payload: RegisterPreparedExecution,
    immutable_sources: dict[str, str] | None = None,
    captured_sources: dict[str, tuple[dict[str, object], ...]] | None = None,
) -> tuple[PreparedTarget, ...]:
    """Use the existing request/recipe producers on byte-verified immutable images.

    Native supplies the canonical sources; the sidecar independently reads and checks
    their bytes. Conversion to data URLs happens once before the pure recipe reads
    references, so changing a file between two opens cannot swap identity unnoticed.
    """
    service = StoryFilmService(repository, tools)
    cache: dict[tuple[str, str], str] = {}
    total = 0
    facts: dict[str, dict[str, object]] = {}
    result = []
    for target in payload.targets:
        body = target.body
        if body.provider != "grok_subscription" or len(body.shots) != 1:
            raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
        declared = {row.source: row.sha256 for row in target.sources}
        if len(declared) != len(target.sources):
            raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
        used: set[str] = set()

        def checked(source: str, declared: dict[str, str] = declared, used: set[str] = used) -> str:
            nonlocal total
            if not source:
                return ""
            expected = declared.get(source)
            if expected is None:
                raise GenerationFailureError("INPUT_UNVERIFIABLE")
            used.add(source)
            key = (source, expected)
            known = cache.get(key)
            if known is not None:
                return known
            if immutable_sources is not None and source in immutable_sources:
                converted = immutable_sources[source]
                canonical = None
                if captured_sources is not None:
                    raise GenerationFailureError("INPUT_UNVERIFIABLE")
            else:
                converted, canonical = reference_snapshot(source)
            if converted is None:
                raise GenerationFailureError("INPUT_UNVERIFIABLE")
            try:
                identity = story_reference_identity(converted)
            except ValueError as error:
                raise GenerationFailureError("INPUT_UNVERIFIABLE") from error
            if identity["sha256"] != expected:
                raise GenerationFailureError("INPUT_UNVERIFIABLE")
            total += len(converted)
            if total > 96 * 1024 * 1024:
                raise GenerationFailureError("INPUT_UNVERIFIABLE")
            cache[key] = converted
            facts[source] = {
                "source": source,
                "canonical_path": canonical,
                "sha256": identity["sha256"],
                "mime": identity["mime"],
            }
            return converted

        forecast = target.forecast
        planned = (
            {row.source: row.identity.model_dump() for row in forecast.sources} if forecast else {}
        )
        if forecast and len(planned) != len(forecast.sources):
            raise GenerationFailureError("INPUT_UNVERIFIABLE")
        # Only this signed, read-only compiler branch can interpret planned locators.
        # No marker is materialized, cached or accepted by the actual send consumer.
        effective = forecast.body if forecast else body
        if effective.provider != body.provider or len(effective.shots) != 1:
            raise GenerationFailureError("INPUT_UNVERIFIABLE")
        consumed_planned: set[str] = set()

        def reference(
            source: str,
            planned: dict[str, Any] = planned,
            consumed_planned: set[str] = consumed_planned,
            checked: Callable[[str], str] = checked,
        ) -> str:
            if source in planned:
                consumed_planned.add(source)
                return source
            return checked(source)

        def identity(source: str, planned: dict[str, Any] = planned) -> object:
            return planned[source] if source in planned else story_reference_identity(source)

        request = story_film_request(effective, f"prepared:{payload.key}:{target.key}")
        shot = request.shots[0]
        immutable = replace(
            shot,
            still=checked(shot.still),
            reference=reference(shot.reference),
            references=tuple(reference(item) for item in shot.references),
        )
        service._begin_creation(replace(request, shots=(immutable,)))
        recipes = service._creation_targets(reference_identity=identity)
        if len(recipes) != 1:
            raise GenerationFailureError("INPUT_UNVERIFIABLE")
        recipe = recipes[0]
        frame = forecast.client_frame if forecast else target.client_frame
        if frame is not None:
            if immutable.still or frame.aspect_ratio != body.aspect_ratio:
                raise GenerationFailureError("INPUT_UNVERIFIABLE")
            # Client first-frame generation replaces the unconsumed API image recipe.
            recipe["image_prompt"] = frame.prompt
            recipe["image_model"] = frame.model
            recipe["image_references"] = [
                identity(reference(source)) for source in frame.references
            ]
        if consumed_planned != set(planned):
            raise GenerationFailureError("INPUT_UNVERIFIABLE")
        if used != set(declared):
            raise GenerationFailureError("INPUT_UNVERIFIABLE")
        if captured_sources is not None:
            captured_sources[target.key] = tuple(facts[source] for source in sorted(used))
        result.append(
            PreparedTarget(
                target.key, recipe, target.versions, target.first_regenerate, body.model_dump()
            )
        )
    return tuple(result)


def runtime_recipe_from_wire(
    repository: StudioRepository,
    tools: Callable[[], MediaToolchain],
    payload: PreparedVideoArm,
) -> dict[str, object]:
    if hashlib.sha256(payload.wire_body.encode()).hexdigest() != payload.body_sha256:
        raise GenerationFailureError("INPUT_UNVERIFIABLE")
    body = CreateStoryFilmBody.model_validate_json(payload.wire_body)
    if body.provider != "grok_subscription" or len(body.shots) != 1:
        raise GenerationFailureError("INPUT_UNVERIFIABLE")
    immutable = materialize_request(
        story_film_request(body, "actual-runtime"),
        parse_sources([row.model_dump() for row in payload.sources]),
    )
    service = StoryFilmService(repository, tools)
    service._begin_creation(immutable)
    return service._creation_targets()[0]


def _snapshot_numbers(value: Any) -> Any:
    """Curated snapshot digest agrees with native JSON for integral producer speeds.

    This is a private snapshot identifier, never the original failure-input digest.
    """
    if isinstance(value, list):
        return [_snapshot_numbers(item) for item in value]
    if isinstance(value, dict):
        return {key: _snapshot_numbers(item) for key, item in value.items()}
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def create_prepared_generation_router(
    repository: Callable[[], StudioRepository],
    tools: Callable[[], MediaToolchain],
    signing_key: str | None,
) -> APIRouter:
    router = APIRouter()
    prefix = "/api/v1/projects/{project_id}/prepared-generation-executions"

    async def account(
        request: Request,
        project_id: Annotated[str, Path(pattern=PROJECT_ID_PATTERN)],
        key: Annotated[
            str, Header(alias="Idempotency-Key", pattern=r"^story-film:v1:[0-9a-f-]{36}$")
        ],
    ) -> str:
        identity = account_attestation(
            request.headers.get("X-Aivora-Generation-Account"),
            key=signing_key,
            project_id=project_id,
            idempotency_key=key,
            body=await request.body(),
            bearer=request.headers.get("X-Aivora-Media-Bearer"),
        )
        if identity is None:
            raise HTTPException(403, "ACCOUNT_UNAVAILABLE")
        return identity

    @router.post(prefix, response_model=RegisteredPreparedExecution)
    def register(
        project_id: str, payload: RegisterPreparedExecution, identity: str = Depends(account)
    ) -> RegisteredPreparedExecution:
        repo = repository()
        try:
            # Private origin facts are not executable filters, paths or authorization.
            if any(
                (stage.kind == "portrait" and stage.view is None)
                or (stage.kind != "portrait" and "view" in stage.model_fields_set)
                for stage in payload.stages
            ):
                raise GenerationFailureError("INPUT_UNVERIFIABLE")
            if any(len(json.dumps(stage.origin).encode()) > 64 * 1024 for stage in payload.stages):
                raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
            targets = original_prepared_recipes(repo, tools, payload)
            identifier = PreparedGenerationStore(repo).register(
                project_id,
                account=identity,
                execution_key=payload.key,
                targets=targets,
                stages=tuple(
                    PreparedStage(
                        stage.key,
                        canonical_stage_fact(stage.model_dump(exclude={"key", "target_keys"})),
                        tuple(stage.target_keys),
                    )
                    for stage in payload.stages
                ),
            )
            return RegisteredPreparedExecution(execution_id=identifier)
        except (GenerationFailureError, ValueError) as error:
            raise HTTPException(409, "INPUT_UNVERIFIABLE") from error

    @router.post(prefix + "/lineages", response_model=PreparedLineageFacts)
    def lineages(
        project_id: str, payload: PreparedLineageQuery, identity: str = Depends(account)
    ) -> PreparedLineageFacts:
        try:
            items = PreparedGenerationStore(repository()).lineages(
                project_id, account=identity, output_sha256s=tuple(payload.output_sha256s)
            )
            return PreparedLineageFacts(
                items=[{**item, "stage": canonical_stage_fact(item["stage"])} for item in items]
            )
        except GenerationFailureError as error:
            raise HTTPException(409, "INPUT_UNVERIFIABLE") from error

    @router.post(
        prefix + "/{execution_id}/cache-preparations",
        response_model=PreparedSlotCacheFacts,
    )
    def prepare_cache_slots(
        project_id: str,
        execution_id: Annotated[str, Path(pattern=r"^[a-f0-9]{32}$")],
        payload: PrepareCacheSlots,
        identity: str = Depends(account),
    ) -> PreparedSlotCacheFacts:
        from aijian_api.prepared_generation_cache import PreparedGenerationCache
        from aijian_api.story_creation_cache import StoryCreationCacheError

        try:
            repo = repository()
            # Reject wrong account/project/retired contexts before touching submitted sources.
            PreparedGenerationStore(repo).preparation_targets(
                project_id, execution_id, account=identity
            )
            sources: dict[str, tuple[dict[str, object], ...]] = {}
            verified = original_prepared_recipes(
                repo, tools, payload.registration, captured_sources=sources
            )
            service = PreparedGenerationCache(repo, tools)
            service.store.verify_preparation_registration(
                project_id,
                execution_id,
                account=identity,
                execution_key=payload.registration.key,
                targets=verified,
            )
            choices = service.prepare(project_id, execution_id, identity, sources)
            items = []
            for choice in choices:
                cache = None
                if choice.snapshot is not None:
                    encoded = json.dumps(
                        _snapshot_numbers(
                            {
                                "snapshot": choice.snapshot,
                                "request": choice.request,
                                "sources": list(choice.sources),
                            }
                        ),
                        sort_keys=True,
                        ensure_ascii=False,
                        separators=(",", ":"),
                        allow_nan=False,
                    )
                    cache = PreparedPrivateCache.model_validate(
                        {
                            "schema_version": 1,
                            "snapshot_sha256": hashlib.sha256(encoded.encode()).hexdigest(),
                            "input_sha256": choice.snapshot["input_sha256"],
                            "request": choice.request,
                            "sources": list(choice.sources),
                            "runtime_recipe": choice.snapshot["runtime_recipe"],
                            "parts": choice.snapshot["parts"],
                        }
                    )
                items.append(
                    PreparedSlotCacheFact(
                        target_key=choice.target_key,
                        slot_index=choice.slot_index,
                        preparation=choice.preparation,
                        cache=cache,
                    )
                )
            return PreparedSlotCacheFacts(items=items)
        except (
            GenerationFailureError,
            StoryCreationCacheError,
            StoryFilmError,
            ValueError,
        ) as error:
            raise HTTPException(409, "INPUT_UNVERIFIABLE") from error

    @router.post(prefix + "/{execution_id}/video-arm", response_model=ArmedPreparedVideo)
    def arm_video(
        project_id: str,
        execution_id: Annotated[str, Path(pattern=r"^[a-f0-9]{32}$")],
        payload: PreparedVideoArm,
        identity: str = Depends(account),
    ) -> ArmedPreparedVideo:
        try:
            repo = repository()
            runtime_recipe = runtime_recipe_from_wire(repo, tools, payload)
            frozen = PreparedGenerationStore(repo).preparations(
                project_id, execution_id, account=identity
            )
            if frozen is not None:
                choice = next(
                    (
                        row
                        for row in frozen
                        if row.target_key == payload.target_key
                        and row.slot_index == payload.slot_index
                    ),
                    None,
                )
                if choice is None:
                    raise GenerationFailureError("INPUT_UNVERIFIABLE")
                body = CreateStoryFilmBody.model_validate_json(payload.wire_body)
                targets = PreparedGenerationStore(repo).preparation_targets(
                    project_id, execution_id, account=identity
                )
                target = next(row for row in targets if row.key == payload.target_key)
                expected_regenerate = target.first_regenerate or payload.slot_index > 0
                if any(
                    (body.regenerate or shot.regenerate) != expected_regenerate
                    for shot in body.shots
                ):
                    raise GenerationFailureError("INPUT_UNVERIFIABLE")
                if choice.preparation == "STORYFILM_CACHE":
                    from aijian_api.prepared_generation_sources import verify_intent_sources

                    if body.model_dump() != choice.request:
                        raise GenerationFailureError("INPUT_UNVERIFIABLE")
                    verify_intent_sources(choice.sources)
            identifier = PreparedGenerationStore(repo).arm_video(
                project_id,
                execution_id,
                account=identity,
                target_key=payload.target_key,
                slot_index=payload.slot_index,
                take_key=payload.take_key,
                body_sha256=payload.body_sha256,
                runtime_recipe=runtime_recipe,
                expected_sources=[row.model_dump() for row in payload.sources],
            )
        except (GenerationFailureError, ValueError) as error:
            code = str(error)
            raise HTTPException(
                409,
                code
                if code in {"EXECUTION_UNAVAILABLE", "ATTEMPT_ALREADY_RESERVED"}
                else "INPUT_UNVERIFIABLE",
            ) from error
        return ArmedPreparedVideo(arm_id=identifier)

    @router.post(prefix + "/{execution_id}/image-dispatch", response_model=RecordedPreparedFact)
    def reserve_image(
        project_id: str,
        execution_id: Annotated[str, Path(pattern=r"^[a-f0-9]{32}$")],
        payload: PreparedImageDispatch,
        identity: str = Depends(account),
    ) -> RecordedPreparedFact:
        try:
            PreparedGenerationStore(repository()).before_image(
                project_id,
                execution_id,
                account=identity,
                stage_key=payload.stage_key,
                body_sha256=payload.body_sha256,
            )
            return RecordedPreparedFact()
        except GenerationFailureError as error:
            code = str(error)
            safe = {
                "UNCONFIGURED",
                "INPUT_FAILURE_LIMIT",
                "VIDEO_UNCONFIGURED",
                "VIDEO_INPUT_FAILURE_LIMIT",
                "ATTEMPT_ALREADY_RESERVED",
                "EXECUTION_UNAVAILABLE",
            }
            raise HTTPException(409, code if code in safe else "INPUT_UNVERIFIABLE") from error

    @router.post(prefix + "/{execution_id}/image-observation", response_model=RecordedPreparedFact)
    def observe_image(
        project_id: str,
        execution_id: Annotated[str, Path(pattern=r"^[a-f0-9]{32}$")],
        payload: PreparedImageObservation,
        identity: str = Depends(account),
    ) -> RecordedPreparedFact:
        try:
            PreparedGenerationStore(repository()).observed_image(
                project_id,
                execution_id,
                account=identity,
                stage_key=payload.stage_key,
                body_sha256=payload.body_sha256,
                output_sha256=payload.output_sha256,
            )
            return RecordedPreparedFact()
        except GenerationFailureError as error:
            raise HTTPException(409, "EXECUTION_UNAVAILABLE") from error

    @router.post(prefix + "/{execution_id}/image-unsent", response_model=RecordedPreparedFact)
    def image_unsent(
        project_id: str,
        execution_id: Annotated[str, Path(pattern=r"^[a-f0-9]{32}$")],
        payload: PreparedImageDispatch,
        identity: str = Depends(account),
    ) -> RecordedPreparedFact:
        try:
            PreparedGenerationStore(repository()).image_was_not_sent(
                project_id,
                execution_id,
                account=identity,
                stage_key=payload.stage_key,
                body_sha256=payload.body_sha256,
            )
            return RecordedPreparedFact()
        except GenerationFailureError as error:
            raise HTTPException(409, "EXECUTION_UNAVAILABLE") from error

    @router.post(prefix + "/{execution_id}/retire", response_model=RecordedPreparedFact)
    def retire(
        project_id: str,
        execution_id: Annotated[str, Path(pattern=r"^[a-f0-9]{32}$")],
        payload: PreparedRetirement,
        identity: str = Depends(account),
    ) -> RecordedPreparedFact:
        try:
            PreparedGenerationStore(repository()).retire(
                project_id,
                execution_id,
                account=identity,
                target_key=payload.target_key,
                slot_index=payload.slot_index,
            )
            return RecordedPreparedFact()
        except GenerationFailureError as error:
            raise HTTPException(409, "EXECUTION_UNAVAILABLE") from error

    return router
