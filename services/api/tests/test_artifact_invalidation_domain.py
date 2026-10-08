from dataclasses import replace
from itertools import permutations
from typing import cast

import pytest
from aijian_api.artifact_invalidation_domain import (
    AcceptedArtifactHead,
    AcceptedHeadReplacement,
    AffectedDownstreamVersion,
    ArtifactVersionIdentity,
    ExactVersionDependency,
    InvalidationReasonPath,
    TypedDependencyInvalidationError,
    TypedDependencyInvalidationInput,
    TypedDependencyInvalidationResult,
    assess_typed_dependency_invalidation,
)
from aijian_api.domain import DependencyImpact

PROJECT = "prj_alpha"
OTHER_PROJECT = "prj_beta"
STORY = "art_story"
EPISODE = "art_episode"
SCREENPLAY = "art_screenplay"
VOICE = "art_voice"
UNRELATED = "art_unrelated"
STORY_OLD = "ver_story_old"
STORY_NEW = "ver_story_new"
EPISODE_ACCEPTED = "ver_episode_accepted"
EPISODE_DRAFT = "ver_episode_draft"
SCREENPLAY_ACCEPTED = "ver_screenplay_accepted"
VOICE_ACCEPTED = "ver_voice_accepted"
UNRELATED_ROOT = "ver_unrelated_root"
UNRELATED_DOWN = "ver_unrelated_down"


def version(
    version_id: str,
    artifact_id: str,
    *,
    project_id: str = PROJECT,
) -> ArtifactVersionIdentity:
    return ArtifactVersionIdentity(
        project_id=project_id,
        artifact_id=artifact_id,
        version_id=version_id,
    )


def head(
    artifact_id: str,
    accepted_version_id: str,
    *,
    project_id: str = PROJECT,
) -> AcceptedArtifactHead:
    return AcceptedArtifactHead(
        project_id=project_id,
        artifact_id=artifact_id,
        accepted_version_id=accepted_version_id,
    )


def dep(
    dependency_id: str,
    *,
    downstream_version_id: str,
    downstream_artifact_id: str,
    upstream_version_id: str,
    upstream_artifact_id: str,
    impact: DependencyImpact,
    relationship: str = "derived_from",
    project_id: str = PROJECT,
) -> ExactVersionDependency:
    return ExactVersionDependency(
        id=dependency_id,
        project_id=project_id,
        downstream_artifact_id=downstream_artifact_id,
        downstream_version_id=downstream_version_id,
        upstream_artifact_id=upstream_artifact_id,
        upstream_version_id=upstream_version_id,
        relationship=relationship,
        impact=impact,
    )


def replacement(
    *,
    old_version_id: str = STORY_OLD,
    new_version_id: str = STORY_NEW,
    artifact_id: str = STORY,
    project_id: str = PROJECT,
) -> AcceptedHeadReplacement:
    return AcceptedHeadReplacement(
        project_id=project_id,
        artifact_id=artifact_id,
        old_version_id=old_version_id,
        new_version_id=new_version_id,
    )


def assessment(
    *,
    versions: tuple[ArtifactVersionIdentity, ...],
    accepted_heads: tuple[AcceptedArtifactHead, ...],
    dependencies: tuple[ExactVersionDependency, ...],
    head_change: AcceptedHeadReplacement | None = None,
    project_id: str = PROJECT,
) -> TypedDependencyInvalidationInput:
    return TypedDependencyInvalidationInput(
        project_id=project_id,
        versions=versions,
        accepted_heads=accepted_heads,
        dependencies=dependencies,
        head_change=head_change if head_change is not None else replacement(),
    )


def story_versions() -> tuple[ArtifactVersionIdentity, ArtifactVersionIdentity]:
    return version(STORY_OLD, STORY), version(STORY_NEW, STORY)


def story_head() -> AcceptedArtifactHead:
    return head(STORY, STORY_NEW)


def reason_path(
    *edges: ExactVersionDependency,
    effective_impact: DependencyImpact,
) -> InvalidationReasonPath:
    return InvalidationReasonPath(
        dependency_ids=tuple(edge.id for edge in edges),
        relationships=tuple(edge.relationship for edge in edges),
        edge_impacts=tuple(edge.impact for edge in edges),
        effective_impact=effective_impact,
    )


def test_direct_blocking_accepted_downstream_is_stale() -> None:
    blocking = dep(
        "dep_episode_blocking",
        downstream_version_id=EPISODE_ACCEPTED,
        downstream_artifact_id=EPISODE,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="blocking",
    )
    result = assess_typed_dependency_invalidation(
        assessment(
            versions=(*story_versions(), version(EPISODE_ACCEPTED, EPISODE)),
            accepted_heads=(story_head(), head(EPISODE, EPISODE_ACCEPTED)),
            dependencies=(blocking,),
        )
    )

    assert result == TypedDependencyInvalidationResult(
        project_id=PROJECT,
        changed_artifact_id=STORY,
        old_version_id=STORY_OLD,
        new_version_id=STORY_NEW,
        affected=(
            AffectedDownstreamVersion(
                version_id=EPISODE_ACCEPTED,
                artifact_id=EPISODE,
                classification="STALE",
                aggregate_impact="blocking",
                reason_paths=(reason_path(blocking, effective_impact="blocking"),),
            ),
        ),
    )


def test_non_accepted_downstream_is_invalidate() -> None:
    draft_edge = dep(
        "dep_episode_draft",
        downstream_version_id=EPISODE_DRAFT,
        downstream_artifact_id=EPISODE,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="blocking",
    )
    result = assess_typed_dependency_invalidation(
        assessment(
            versions=(
                *story_versions(),
                version(EPISODE_DRAFT, EPISODE),
                version(EPISODE_ACCEPTED, EPISODE),
            ),
            accepted_heads=(story_head(), head(EPISODE, EPISODE_ACCEPTED)),
            dependencies=(draft_edge,),
        )
    )

    assert result.affected == (
        AffectedDownstreamVersion(
            version_id=EPISODE_DRAFT,
            artifact_id=EPISODE,
            classification="INVALIDATE",
            aggregate_impact="blocking",
            reason_paths=(reason_path(draft_edge, effective_impact="blocking"),),
        ),
    )


def test_advisory_and_render_only_impacts_remain_visible() -> None:
    advisory = dep(
        "dep_episode_advisory",
        downstream_version_id=EPISODE_ACCEPTED,
        downstream_artifact_id=EPISODE,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="advisory",
        relationship="references",
    )
    render_only = dep(
        "dep_screenplay_render",
        downstream_version_id=SCREENPLAY_ACCEPTED,
        downstream_artifact_id=SCREENPLAY,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="render_only",
        relationship="renders",
    )
    both_advisory = dep(
        "dep_voice_advisory",
        downstream_version_id=VOICE_ACCEPTED,
        downstream_artifact_id=VOICE,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="advisory",
    )
    both_render = dep(
        "dep_voice_render",
        downstream_version_id=VOICE_ACCEPTED,
        downstream_artifact_id=VOICE,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="render_only",
    )
    result = assess_typed_dependency_invalidation(
        assessment(
            versions=(
                *story_versions(),
                version(EPISODE_ACCEPTED, EPISODE),
                version(SCREENPLAY_ACCEPTED, SCREENPLAY),
                version(VOICE_ACCEPTED, VOICE),
            ),
            accepted_heads=(
                story_head(),
                head(EPISODE, EPISODE_ACCEPTED),
                head(SCREENPLAY, SCREENPLAY_ACCEPTED),
                head(VOICE, VOICE_ACCEPTED),
            ),
            dependencies=(advisory, render_only, both_advisory, both_render),
        )
    )

    assert result.affected == (
        AffectedDownstreamVersion(
            version_id=EPISODE_ACCEPTED,
            artifact_id=EPISODE,
            classification="STALE",
            aggregate_impact="advisory",
            reason_paths=(reason_path(advisory, effective_impact="advisory"),),
        ),
        AffectedDownstreamVersion(
            version_id=SCREENPLAY_ACCEPTED,
            artifact_id=SCREENPLAY,
            classification="STALE",
            aggregate_impact="render_only",
            reason_paths=(reason_path(render_only, effective_impact="render_only"),),
        ),
        AffectedDownstreamVersion(
            version_id=VOICE_ACCEPTED,
            artifact_id=VOICE,
            classification="STALE",
            aggregate_impact="render_only",
            reason_paths=(
                reason_path(both_advisory, effective_impact="advisory"),
                reason_path(both_render, effective_impact="render_only"),
            ),
        ),
    )


def test_multi_hop_path_uses_least_restrictive_edge() -> None:
    to_episode = dep(
        "dep_to_episode",
        downstream_version_id=EPISODE_ACCEPTED,
        downstream_artifact_id=EPISODE,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="blocking",
        relationship="episode_to_story",
    )
    to_screenplay = dep(
        "dep_to_screenplay",
        downstream_version_id=SCREENPLAY_ACCEPTED,
        downstream_artifact_id=SCREENPLAY,
        upstream_version_id=EPISODE_ACCEPTED,
        upstream_artifact_id=EPISODE,
        impact="render_only",
        relationship="screenplay_to_episode",
    )
    to_voice = dep(
        "dep_to_voice",
        downstream_version_id=VOICE_ACCEPTED,
        downstream_artifact_id=VOICE,
        upstream_version_id=SCREENPLAY_ACCEPTED,
        upstream_artifact_id=SCREENPLAY,
        impact="advisory",
        relationship="voice_to_screenplay",
    )
    result = assess_typed_dependency_invalidation(
        assessment(
            versions=(
                *story_versions(),
                version(EPISODE_ACCEPTED, EPISODE),
                version(SCREENPLAY_ACCEPTED, SCREENPLAY),
                version(VOICE_ACCEPTED, VOICE),
            ),
            accepted_heads=(
                story_head(),
                head(EPISODE, EPISODE_ACCEPTED),
                head(SCREENPLAY, SCREENPLAY_ACCEPTED),
                head(VOICE, VOICE_ACCEPTED),
            ),
            dependencies=(to_episode, to_screenplay, to_voice),
        )
    )

    assert result.affected == (
        AffectedDownstreamVersion(
            version_id=EPISODE_ACCEPTED,
            artifact_id=EPISODE,
            classification="STALE",
            aggregate_impact="blocking",
            reason_paths=(
                InvalidationReasonPath(
                    dependency_ids=("dep_to_episode",),
                    relationships=("episode_to_story",),
                    edge_impacts=("blocking",),
                    effective_impact="blocking",
                ),
            ),
        ),
        AffectedDownstreamVersion(
            version_id=SCREENPLAY_ACCEPTED,
            artifact_id=SCREENPLAY,
            classification="STALE",
            aggregate_impact="render_only",
            reason_paths=(
                InvalidationReasonPath(
                    dependency_ids=("dep_to_screenplay", "dep_to_episode"),
                    relationships=("screenplay_to_episode", "episode_to_story"),
                    edge_impacts=("render_only", "blocking"),
                    effective_impact="render_only",
                ),
            ),
        ),
        AffectedDownstreamVersion(
            version_id=VOICE_ACCEPTED,
            artifact_id=VOICE,
            classification="STALE",
            aggregate_impact="advisory",
            reason_paths=(
                InvalidationReasonPath(
                    dependency_ids=("dep_to_voice", "dep_to_screenplay", "dep_to_episode"),
                    relationships=(
                        "voice_to_screenplay",
                        "screenplay_to_episode",
                        "episode_to_story",
                    ),
                    edge_impacts=("advisory", "render_only", "blocking"),
                    effective_impact="advisory",
                ),
            ),
        ),
    )


def _diamond_edges() -> tuple[ExactVersionDependency, ...]:
    return (
        dep(
            "dep_left",
            downstream_version_id=EPISODE_ACCEPTED,
            downstream_artifact_id=EPISODE,
            upstream_version_id=STORY_OLD,
            upstream_artifact_id=STORY,
            impact="blocking",
            relationship="episode_to_story",
        ),
        dep(
            "dep_right",
            downstream_version_id=SCREENPLAY_ACCEPTED,
            downstream_artifact_id=SCREENPLAY,
            upstream_version_id=STORY_OLD,
            upstream_artifact_id=STORY,
            impact="advisory",
            relationship="screenplay_to_story",
        ),
        dep(
            "dep_join_left",
            downstream_version_id=VOICE_ACCEPTED,
            downstream_artifact_id=VOICE,
            upstream_version_id=EPISODE_ACCEPTED,
            upstream_artifact_id=EPISODE,
            impact="advisory",
            relationship="voice_to_episode",
        ),
        dep(
            "dep_join_right",
            downstream_version_id=VOICE_ACCEPTED,
            downstream_artifact_id=VOICE,
            upstream_version_id=SCREENPLAY_ACCEPTED,
            upstream_artifact_id=SCREENPLAY,
            impact="blocking",
            relationship="voice_to_screenplay",
        ),
    )


def _diamond_assessment(
    *,
    dependencies: tuple[ExactVersionDependency, ...] | None = None,
    versions: tuple[ArtifactVersionIdentity, ...] | None = None,
    accepted_heads: tuple[AcceptedArtifactHead, ...] | None = None,
) -> TypedDependencyInvalidationInput:
    return assessment(
        versions=versions
        or (
            *story_versions(),
            version(EPISODE_ACCEPTED, EPISODE),
            version(SCREENPLAY_ACCEPTED, SCREENPLAY),
            version(VOICE_ACCEPTED, VOICE),
        ),
        accepted_heads=accepted_heads
        or (
            story_head(),
            head(EPISODE, EPISODE_ACCEPTED),
            head(SCREENPLAY, SCREENPLAY_ACCEPTED),
            head(VOICE, VOICE_ACCEPTED),
        ),
        dependencies=dependencies or _diamond_edges(),
    )


def test_diamond_retains_both_independent_reason_paths() -> None:
    result = assess_typed_dependency_invalidation(_diamond_assessment())
    join = next(item for item in result.affected if item.version_id == VOICE_ACCEPTED)

    assert join.reason_paths == (
        InvalidationReasonPath(
            dependency_ids=("dep_join_left", "dep_left"),
            relationships=("voice_to_episode", "episode_to_story"),
            edge_impacts=("advisory", "blocking"),
            effective_impact="advisory",
        ),
        InvalidationReasonPath(
            dependency_ids=("dep_join_right", "dep_right"),
            relationships=("voice_to_screenplay", "screenplay_to_story"),
            edge_impacts=("blocking", "advisory"),
            effective_impact="advisory",
        ),
    )
    assert join.aggregate_impact == "advisory"
    assert {item.version_id for item in result.affected} == {
        EPISODE_ACCEPTED,
        SCREENPLAY_ACCEPTED,
        VOICE_ACCEPTED,
    }


def test_multiple_paths_aggregate_strongest_effective_impact() -> None:
    weak_first = dep(
        "dep_weak_first",
        downstream_version_id=EPISODE_ACCEPTED,
        downstream_artifact_id=EPISODE,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="blocking",
        relationship="episode_to_story",
    )
    weak_second = dep(
        "dep_weak_second",
        downstream_version_id=VOICE_ACCEPTED,
        downstream_artifact_id=VOICE,
        upstream_version_id=EPISODE_ACCEPTED,
        upstream_artifact_id=EPISODE,
        impact="advisory",
        relationship="voice_to_episode",
    )
    strong_direct = dep(
        "dep_strong_direct",
        downstream_version_id=VOICE_ACCEPTED,
        downstream_artifact_id=VOICE,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="render_only",
        relationship="voice_to_story",
    )
    result = assess_typed_dependency_invalidation(
        assessment(
            versions=(
                *story_versions(),
                version(EPISODE_ACCEPTED, EPISODE),
                version(VOICE_ACCEPTED, VOICE),
            ),
            accepted_heads=(
                story_head(),
                head(EPISODE, EPISODE_ACCEPTED),
                head(VOICE, VOICE_ACCEPTED),
            ),
            dependencies=(weak_first, weak_second, strong_direct),
        )
    )
    join = next(item for item in result.affected if item.version_id == VOICE_ACCEPTED)

    assert join.aggregate_impact == "render_only"
    assert join.reason_paths == (
        InvalidationReasonPath(
            dependency_ids=("dep_strong_direct",),
            relationships=("voice_to_story",),
            edge_impacts=("render_only",),
            effective_impact="render_only",
        ),
        InvalidationReasonPath(
            dependency_ids=("dep_weak_second", "dep_weak_first"),
            relationships=("voice_to_episode", "episode_to_story"),
            edge_impacts=("advisory", "blocking"),
            effective_impact="advisory",
        ),
    )


def test_result_and_reason_order_are_stable_under_input_permutations() -> None:
    baseline = assess_typed_dependency_invalidation(_diamond_assessment())
    join = next(item for item in baseline.affected if item.version_id == VOICE_ACCEPTED)
    assert join.reason_paths == (
        InvalidationReasonPath(
            dependency_ids=("dep_join_left", "dep_left"),
            relationships=("voice_to_episode", "episode_to_story"),
            edge_impacts=("advisory", "blocking"),
            effective_impact="advisory",
        ),
        InvalidationReasonPath(
            dependency_ids=("dep_join_right", "dep_right"),
            relationships=("voice_to_screenplay", "screenplay_to_story"),
            edge_impacts=("blocking", "advisory"),
            effective_impact="advisory",
        ),
    )
    versions = _diamond_assessment().versions
    heads = _diamond_assessment().accepted_heads
    edges = _diamond_edges()

    for dependency_order in permutations(edges):
        for version_order in (
            versions,
            tuple(reversed(versions)),
            (versions[2], versions[0], versions[4], versions[1], versions[3]),
        ):
            for head_order in (heads, tuple(reversed(heads))):
                permuted = assess_typed_dependency_invalidation(
                    _diamond_assessment(
                        dependencies=dependency_order,
                        versions=version_order,
                        accepted_heads=head_order,
                    )
                )
                assert permuted == baseline


def test_unrelated_branch_is_absent() -> None:
    related = dep(
        "dep_related",
        downstream_version_id=EPISODE_ACCEPTED,
        downstream_artifact_id=EPISODE,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="blocking",
    )
    unrelated = dep(
        "dep_unrelated",
        downstream_version_id=UNRELATED_DOWN,
        downstream_artifact_id=UNRELATED,
        upstream_version_id=UNRELATED_ROOT,
        upstream_artifact_id=UNRELATED,
        impact="blocking",
    )
    result = assess_typed_dependency_invalidation(
        assessment(
            versions=(
                *story_versions(),
                version(EPISODE_ACCEPTED, EPISODE),
                version(UNRELATED_ROOT, UNRELATED),
                version(UNRELATED_DOWN, UNRELATED),
            ),
            accepted_heads=(
                story_head(),
                head(EPISODE, EPISODE_ACCEPTED),
                head(UNRELATED, UNRELATED_DOWN),
            ),
            dependencies=(related, unrelated),
        )
    )

    assert [item.version_id for item in result.affected] == [EPISODE_ACCEPTED]


def test_cross_project_identity_fails_closed() -> None:
    blocking = dep(
        "dep_episode_blocking",
        downstream_version_id=EPISODE_ACCEPTED,
        downstream_artifact_id=EPISODE,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="blocking",
    )
    valid = assessment(
        versions=(*story_versions(), version(EPISODE_ACCEPTED, EPISODE)),
        accepted_heads=(story_head(), head(EPISODE, EPISODE_ACCEPTED)),
        dependencies=(blocking,),
    )

    with pytest.raises(TypedDependencyInvalidationError, match="project identity"):
        assess_typed_dependency_invalidation(
            replace(
                valid,
                versions=(
                    *valid.versions,
                    version("ver_other", EPISODE, project_id=OTHER_PROJECT),
                ),
            )
        )
    with pytest.raises(TypedDependencyInvalidationError, match="project identity"):
        assess_typed_dependency_invalidation(
            replace(
                valid,
                accepted_heads=(
                    *valid.accepted_heads,
                    head(VOICE, VOICE_ACCEPTED, project_id=OTHER_PROJECT),
                ),
            )
        )
    with pytest.raises(TypedDependencyInvalidationError, match="project identity"):
        assess_typed_dependency_invalidation(
            replace(
                valid,
                dependencies=(
                    *valid.dependencies,
                    replace(blocking, id="dep_other", project_id=OTHER_PROJECT),
                ),
            )
        )
    with pytest.raises(TypedDependencyInvalidationError, match="project identity"):
        assess_typed_dependency_invalidation(
            replace(valid, head_change=replacement(project_id=OTHER_PROJECT))
        )


def test_missing_head_version_or_dependency_endpoint_fails_closed() -> None:
    blocking = dep(
        "dep_episode_blocking",
        downstream_version_id=EPISODE_ACCEPTED,
        downstream_artifact_id=EPISODE,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="blocking",
    )
    valid = assessment(
        versions=(*story_versions(), version(EPISODE_ACCEPTED, EPISODE)),
        accepted_heads=(story_head(), head(EPISODE, EPISODE_ACCEPTED)),
        dependencies=(blocking,),
    )

    with pytest.raises(TypedDependencyInvalidationError, match="accepted head"):
        assess_typed_dependency_invalidation(
            replace(valid, accepted_heads=(head(EPISODE, EPISODE_ACCEPTED),))
        )
    with pytest.raises(TypedDependencyInvalidationError, match="missing version"):
        assess_typed_dependency_invalidation(
            replace(valid, accepted_heads=(*valid.accepted_heads, head(VOICE, "ver_missing")))
        )
    with pytest.raises(TypedDependencyInvalidationError, match="missing version"):
        assess_typed_dependency_invalidation(replace(valid, versions=story_versions()))
    with pytest.raises(TypedDependencyInvalidationError, match="missing version"):
        assess_typed_dependency_invalidation(
            replace(valid, head_change=replacement(old_version_id="ver_missing_old"))
        )


def test_head_version_artifact_identity_mismatch_fails_closed() -> None:
    blocking = dep(
        "dep_episode_blocking",
        downstream_version_id=EPISODE_ACCEPTED,
        downstream_artifact_id=EPISODE,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="blocking",
    )
    valid = assessment(
        versions=(*story_versions(), version(EPISODE_ACCEPTED, EPISODE)),
        accepted_heads=(story_head(), head(EPISODE, EPISODE_ACCEPTED)),
        dependencies=(blocking,),
    )

    with pytest.raises(TypedDependencyInvalidationError, match="accepted head"):
        assess_typed_dependency_invalidation(
            replace(valid, accepted_heads=(story_head(), head(VOICE, EPISODE_ACCEPTED)))
        )
    with pytest.raises(TypedDependencyInvalidationError, match="artifact identity"):
        assess_typed_dependency_invalidation(
            replace(valid, dependencies=(replace(blocking, downstream_artifact_id=VOICE),))
        )
    with pytest.raises(TypedDependencyInvalidationError, match="artifact identity"):
        assess_typed_dependency_invalidation(
            replace(valid, dependencies=(replace(blocking, upstream_artifact_id=EPISODE),))
        )


def test_old_new_current_head_change_mismatch_fails_closed() -> None:
    blocking = dep(
        "dep_episode_blocking",
        downstream_version_id=EPISODE_ACCEPTED,
        downstream_artifact_id=EPISODE,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="blocking",
    )
    valid = assessment(
        versions=(
            *story_versions(),
            version(EPISODE_ACCEPTED, EPISODE),
            version("ver_other_story", STORY),
        ),
        accepted_heads=(story_head(), head(EPISODE, EPISODE_ACCEPTED)),
        dependencies=(blocking,),
    )

    with pytest.raises(TypedDependencyInvalidationError, match="old and new"):
        assess_typed_dependency_invalidation(
            replace(
                valid,
                head_change=replacement(old_version_id=STORY_NEW, new_version_id=STORY_NEW),
            )
        )
    with pytest.raises(TypedDependencyInvalidationError, match="current accepted head"):
        assess_typed_dependency_invalidation(
            replace(valid, accepted_heads=(head(STORY, STORY_OLD), head(EPISODE, EPISODE_ACCEPTED)))
        )
    with pytest.raises(TypedDependencyInvalidationError, match="declared changed artifact"):
        assess_typed_dependency_invalidation(
            replace(valid, head_change=replacement(old_version_id=EPISODE_ACCEPTED))
        )
    with pytest.raises(TypedDependencyInvalidationError, match="declared changed artifact"):
        assess_typed_dependency_invalidation(
            replace(valid, head_change=replacement(new_version_id=EPISODE_ACCEPTED))
        )


def test_dependency_cycle_fails_closed() -> None:
    reachable = (
        dep(
            "dep_to_episode",
            downstream_version_id=EPISODE_ACCEPTED,
            downstream_artifact_id=EPISODE,
            upstream_version_id=STORY_OLD,
            upstream_artifact_id=STORY,
            impact="blocking",
        ),
        dep(
            "dep_back_to_story",
            downstream_version_id=STORY_OLD,
            downstream_artifact_id=STORY,
            upstream_version_id=EPISODE_ACCEPTED,
            upstream_artifact_id=EPISODE,
            impact="advisory",
        ),
    )
    unreachable = (
        dep(
            "dep_unrelated",
            downstream_version_id=UNRELATED_DOWN,
            downstream_artifact_id=UNRELATED,
            upstream_version_id=UNRELATED_ROOT,
            upstream_artifact_id=UNRELATED,
            impact="blocking",
        ),
        dep(
            "dep_unrelated_back",
            downstream_version_id=UNRELATED_ROOT,
            downstream_artifact_id=UNRELATED,
            upstream_version_id=UNRELATED_DOWN,
            upstream_artifact_id=UNRELATED,
            impact="advisory",
        ),
    )

    with pytest.raises(TypedDependencyInvalidationError, match="cycle"):
        assess_typed_dependency_invalidation(
            assessment(
                versions=(*story_versions(), version(EPISODE_ACCEPTED, EPISODE)),
                accepted_heads=(story_head(), head(EPISODE, EPISODE_ACCEPTED)),
                dependencies=reachable,
            )
        )
    with pytest.raises(TypedDependencyInvalidationError, match="cycle"):
        assess_typed_dependency_invalidation(
            assessment(
                versions=(
                    *story_versions(),
                    version(EPISODE_ACCEPTED, EPISODE),
                    version(UNRELATED_ROOT, UNRELATED),
                    version(UNRELATED_DOWN, UNRELATED),
                ),
                accepted_heads=(
                    story_head(),
                    head(EPISODE, EPISODE_ACCEPTED),
                    head(UNRELATED, UNRELATED_DOWN),
                ),
                dependencies=(
                    dep(
                        "dep_related",
                        downstream_version_id=EPISODE_ACCEPTED,
                        downstream_artifact_id=EPISODE,
                        upstream_version_id=STORY_OLD,
                        upstream_artifact_id=STORY,
                        impact="blocking",
                    ),
                    *unreachable,
                ),
            )
        )


def test_duplicate_and_inconsistent_ids_fail_closed() -> None:
    blocking = dep(
        "dep_episode_blocking",
        downstream_version_id=EPISODE_ACCEPTED,
        downstream_artifact_id=EPISODE,
        upstream_version_id=STORY_OLD,
        upstream_artifact_id=STORY,
        impact="blocking",
    )
    valid = assessment(
        versions=(*story_versions(), version(EPISODE_ACCEPTED, EPISODE)),
        accepted_heads=(story_head(), head(EPISODE, EPISODE_ACCEPTED)),
        dependencies=(blocking,),
    )

    with pytest.raises(TypedDependencyInvalidationError, match="duplicate"):
        assess_typed_dependency_invalidation(
            replace(valid, versions=(*valid.versions, version(EPISODE_ACCEPTED, EPISODE)))
        )
    with pytest.raises(TypedDependencyInvalidationError, match="duplicate"):
        assess_typed_dependency_invalidation(
            replace(valid, accepted_heads=(*valid.accepted_heads, head(EPISODE, EPISODE_ACCEPTED)))
        )
    with pytest.raises(TypedDependencyInvalidationError, match="duplicate"):
        assess_typed_dependency_invalidation(
            replace(
                valid,
                dependencies=(
                    blocking,
                    replace(blocking, impact="advisory"),
                ),
            )
        )
    with pytest.raises(TypedDependencyInvalidationError, match="unsupported"):
        assess_typed_dependency_invalidation(
            replace(
                valid,
                dependencies=(replace(blocking, impact=cast(DependencyImpact, "critical")),),
            )
        )


def test_input_is_unchanged_and_repeated_calls_return_equal_frozen_results() -> None:
    source = _diamond_assessment()
    versions = source.versions
    heads = source.accepted_heads
    dependencies = source.dependencies
    head_change = source.head_change

    first = assess_typed_dependency_invalidation(source)
    second = assess_typed_dependency_invalidation(source)

    assert source.versions is versions
    assert source.accepted_heads is heads
    assert source.dependencies is dependencies
    assert source.head_change is head_change
    assert source.versions == versions
    assert source.accepted_heads == heads
    assert source.dependencies == dependencies
    assert first == second
    assert first is not second
    assert isinstance(first, TypedDependencyInvalidationResult)
    assert hash(first) == hash(second)
