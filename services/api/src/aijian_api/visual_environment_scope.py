"""Exact environment declaration; never infer approval from all library entries."""

from aijian_api.project_creative_library_contracts import ProjectCreativeLibraryContent
from aijian_api.project_environment_contracts import ProjectEnvironmentReferenceV1
from aijian_api.visual_bible_contracts import VisualBibleContent


def environment_projection(
    content: VisualBibleContent, library: ProjectCreativeLibraryContent
) -> dict[str, object] | None:
    if content.schema_version == "1.0.0":
        return None
    if library.schema_version != "1.3.0":
        raise ValueError("Environment approval needs the exact environment-aware library")
    scope = content.environment_scope
    scenes = {s.scene_id for s in content.scenes}
    variants = {s.variant_id: s for s in library.scene_variants}
    refs = {r.reference_id: r for r in library.environment_references}
    if any(
        id not in variants or variants[id].scene_id not in scenes for id in scope.scene_variant_ids
    ):
        raise ValueError("Approved state is outside the declared visual locations")
    for id in scope.environment_reference_ids:
        ref = refs.get(id)
        if (
            ref is None
            or (ref.scene_id is not None and ref.scene_id not in scenes)
            or (ref.variant_id is not None and ref.variant_id not in scope.scene_variant_ids)
        ):
            raise ValueError("Approved reference is outside the declared environment scope")
    return {
        "declaration": scope.model_dump(mode="json"),
        "world": library.world.model_dump(mode="json"),
        "states": [variants[id].model_dump(mode="json") for id in scope.scene_variant_ids],
        "references": [refs[id].model_dump(mode="json") for id in scope.environment_reference_ids],
    }


def environment_sources(
    content: VisualBibleContent, library: ProjectCreativeLibraryContent
) -> tuple[ProjectEnvironmentReferenceV1, ...]:
    environment_projection(content, library)
    if content.schema_version == "1.0.0" or library.schema_version != "1.3.0":
        return ()
    selected = set(content.environment_scope.environment_reference_ids)
    return tuple(r for r in library.environment_references if r.reference_id in selected)
