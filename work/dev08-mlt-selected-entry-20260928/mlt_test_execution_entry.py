"""Closed, server-only entry for the single ART04 engineering render.

No product route imports this module. A reviewed MLT runtime must be pinned in
the local allowlist before this entry can launch an external process.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Callable
from pathlib import Path

from aijian_api.media_execution_plan_contracts import MediaExecutionPlanV1
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.mlt_execution_adapter import (
    build_mlt_engineering_blueprint,
    materialize_mlt_engineering_task,
)
from aijian_api.mlt_execution_worker import (
    MAX_MLT_SECONDS,
    MltEngineeringRuntime,
    MltExecutionError,
    MltExecutionEvidence,
    run_mlt_engineering_task,
)
from aijian_api.mlt_test_selection_resolver import (
    QA02_FIVE_INPUT_MANIFEST_SHA256,
    TestSelectionRequest,
    prepare_test_selection,
)


# REL02 has not approved a complete MLT runtime inventory for this TEST.
_APPROVED_MLT_RUNTIME_MANIFEST_SHA256: frozenset[str] = frozenset()


def _runtime_manifest_sha256(runtime: MltEngineeringRuntime) -> str:
    """Bind approval to the exact local root, version, and complete file list."""
    entries = (
        f"root={runtime.installation_root}",
        f"modules={runtime.module_directory}",
        f"version={runtime.expected_version}",
        *(f"{item.path}|{item.sha256}" for item in (
            runtime.melt, *runtime.runtime_files,
        )),
    )
    return hashlib.sha256("\n".join(entries).encode("utf-8")).hexdigest()


def run_selected_art04_test(
    request: TestSelectionRequest,
    frozen_plan: MediaExecutionPlanV1,
    *,
    operation_id: str,
    work_root: Path,
    runtime: MltEngineeringRuntime,
    verifier_toolchain: MediaToolchain,
    on_progress: Callable[[int], None],
    stop_requested: Callable[[], bool],
    timeout_seconds: float = MAX_MLT_SECONDS,
) -> MltExecutionEvidence:
    """Resolve, assemble, recheck, and run one selected TEST; return memory only."""
    if (
        not isinstance(request, TestSelectionRequest)
        or not isinstance(frozen_plan, MediaExecutionPlanV1)
        or not isinstance(runtime, MltEngineeringRuntime)
        or not isinstance(verifier_toolchain, MediaToolchain)
        or not callable(on_progress) or not callable(stop_requested)
        or isinstance(timeout_seconds, bool)
        or not isinstance(timeout_seconds, int | float)
        or not math.isfinite(timeout_seconds)
        or not 0 < timeout_seconds <= MAX_MLT_SECONDS
    ):
        raise MltExecutionError("TEST_INPUT_INVALID", "Engineering TEST inputs are invalid")
    if _runtime_manifest_sha256(runtime) not in _APPROVED_MLT_RUNTIME_MANIFEST_SHA256:
        raise MltExecutionError("MLT_RUNTIME_UNAPPROVED", "No approved TEST runtime is pinned")

    selected = prepare_test_selection(request)
    if (
        selected.plan != frozen_plan
        or selected.plan.content_hash != frozen_plan.content_hash
        or selected.fixture_manifest.sha256 != QA02_FIVE_INPUT_MANIFEST_SHA256
        or selected.fixture_manifest.path != request.manifest_path
        or len(frozen_plan.subtitle_cues) != 2
        or any(
            cue.font_family != request.subtitle_style.font_family
            or cue.font_size_px != request.subtitle_style.font_size_px
            or cue.color_rgba != request.subtitle_style.color_rgba
            for cue in frozen_plan.subtitle_cues
        )
    ):
        raise MltExecutionError("TEST_PLAN_CHANGED", "Frozen plan or subtitle style changed")

    blueprint = build_mlt_engineering_blueprint(
        frozen_plan,
        resolve_selected=selected.resolve_selected,
        subtitle_file=selected.subtitle_file,
        fixture_manifest=selected.fixture_manifest,
    )
    resources = (*blueprint.selected_resources, blueprint.subtitle_file)
    selected.revalidate(frozen_plan, resources)
    task = materialize_mlt_engineering_task(
        blueprint, operation_id=operation_id, work_root=work_root,
    )
    if task.plan != frozen_plan or task.resources != resources:
        raise MltExecutionError("TEST_TASK_CHANGED", "Materialized TEST differs from its plan")
    return run_mlt_engineering_task(
        task, runtime, verifier_toolchain,
        on_progress=on_progress,
        stop_requested=stop_requested,
        revalidate_selection=selected.revalidate,
        timeout_seconds=timeout_seconds,
    )
