"""Resolve manual shot choices against the exact pinned creative library."""

from aijian_api.episode_storyboard_contracts import EpisodeStoryboardContent
from aijian_api.project_character_details_contracts import ProjectCharacterReferenceV1
from aijian_api.project_creative_library_contracts import ProjectCreativeLibraryContent


def selected_character_references(
    content: EpisodeStoryboardContent, library: ProjectCreativeLibraryContent
) -> tuple[ProjectCharacterReferenceV1, ...]:
    if content.schema_version == "1.0.0":
        return ()
    costumes = (
        {}
        if library.schema_version == "1.0.0"
        else {item.costume_id: item.character_id for item in library.costumes}
    )
    references = (
        {}
        if library.schema_version not in ("1.2.0", "1.3.0")
        else {item.reference_id: item for item in library.references}
    )
    selected: dict[str, ProjectCharacterReferenceV1] = {}
    for shot in content.shots:
        for binding in shot.character_bindings:
            if (
                binding.costume_id is not None
                and costumes.get(binding.costume_id) != binding.character_id
            ):
                raise ValueError(
                    "Costume is not owned by the selected character in the pinned library"
                )
            for ref_id in binding.reference_ids:
                reference = references.get(ref_id)
                if (
                    reference is None
                    or reference.character_id != binding.character_id
                    or reference.costume_id not in (None, binding.costume_id)
                ):
                    raise ValueError(
                        "Reference does not belong to this character/costume in the pinned library"
                    )
                selected[ref_id] = reference
    return tuple(selected.values())
