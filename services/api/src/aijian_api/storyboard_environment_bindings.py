"""Resolve manual environment choices against the exact immutable library."""

from aijian_api.episode_storyboard_contracts import EpisodeStoryboardContent
from aijian_api.project_creative_library_contracts import ProjectCreativeLibraryContent
from aijian_api.project_environment_contracts import ProjectEnvironmentReferenceV1


def selected_environment_references(
    content: EpisodeStoryboardContent, library: ProjectCreativeLibraryContent
) -> tuple[ProjectEnvironmentReferenceV1, ...]:
    if content.schema_version not in ("1.4.0", "1.5.0"):
        return ()
    variants = (
        {item.variant_id: item.scene_id for item in library.scene_variants}
        if library.schema_version == "1.3.0"
        else {}
    )
    references = (
        {item.reference_id: item for item in library.environment_references}
        if library.schema_version == "1.3.0"
        else {}
    )
    selected: dict[str, ProjectEnvironmentReferenceV1] = {}
    for shot in content.shots:
        binding = shot.environment_binding
        if binding.variant_id is not None and variants.get(binding.variant_id) != shot.location_id:
            raise ValueError("Selected state is outside this location in the pinned library")
        for id in binding.reference_ids:
            ref = references.get(id)
            if (
                ref is None
                or (ref.scene_id is not None and ref.scene_id != shot.location_id)
                or ref.variant_id not in (None, binding.variant_id)
            ):
                raise ValueError("Environment reference is outside this world/location/state scope")
            selected[id] = ref
    return tuple(selected.values())
