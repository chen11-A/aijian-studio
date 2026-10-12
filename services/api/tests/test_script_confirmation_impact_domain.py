"""Source graph traversal refuses before truncation; old Gate behavior remains explicit."""

import pytest
from aijian_api.artifact_invalidation_domain import (
    ArtifactVersionIdentity,
    ExactVersionDependency,
    SourceVersionReplacementInput,
    TypedDependencyInvalidationError,
    assess_source_version_replacement,
)


def source_graph(depth):
    versions = (
        ArtifactVersionIdentity("project", "script", "old"),
        ArtifactVersionIdentity("project", "script", "new"),
        *(
            ArtifactVersionIdentity("project", f"artifact-{i}", f"version-{i}")
            for i in range(depth)
        ),
    )
    edges = tuple(
        ExactVersionDependency(
            f"edge-{i}",
            "project",
            f"artifact-{i}",
            f"version-{i}",
            "script" if i == 0 else f"artifact-{i - 1}",
            "old" if i == 0 else f"version-{i - 1}",
            "references",
            "blocking",
        )
        for i in range(depth)
    )
    return SourceVersionReplacementInput("project", versions, edges, "script", "old", "new")


def test_depth_64_completes_and_65_refuses_during_traversal():
    assert len(assess_source_version_replacement(source_graph(64))) == 64
    with pytest.raises(TypedDependencyInvalidationError, match="depth"):
        assess_source_version_replacement(source_graph(65))


def test_node_budget_and_duplicate_or_foreign_identity_fail_closed():
    graph = source_graph(1)
    huge = (
        *graph.versions,
        *(ArtifactVersionIdentity("project", f"art-{i}", f"ver-{i}") for i in range(10000)),
    )
    with pytest.raises(TypedDependencyInvalidationError):
        assess_source_version_replacement(
            SourceVersionReplacementInput(
                "project", huge, graph.dependencies, "script", "old", "new"
            )
        )
    with pytest.raises(TypedDependencyInvalidationError):
        assess_source_version_replacement(
            SourceVersionReplacementInput(
                "project",
                (*graph.versions, graph.versions[0]),
                graph.dependencies,
                "script",
                "old",
                "new",
            )
        )
    with pytest.raises(TypedDependencyInvalidationError):
        assess_source_version_replacement(
            SourceVersionReplacementInput(
                "other-project", graph.versions, graph.dependencies, "script", "old", "new"
            )
        )
