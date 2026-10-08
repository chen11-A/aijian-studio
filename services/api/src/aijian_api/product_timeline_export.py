"""Read-only product export readiness; no task, encoder, or output is created."""

from __future__ import annotations

from pathlib import Path

from aijian_api.artifacts import canonical_content_hash
from aijian_api.media_toolchain import MediaToolchainError, load_media_toolchain_lock
from aijian_api.product_timeline_export_contracts import (
    ProductExportPreflightData,
    ProductExportPreflightIssue,
    ProductExportPreflightRequest,
    ProductExportIssueScope,
)
from aijian_api.repository import (
    ArtifactConflictError,
    EpisodeNotFoundError,
    ProjectNotFoundError,
    StudioRepository,
)
from aijian_api.timeline import TimelineVersionV1


class ProductTimelineExportPreflightService:
    """Report real blockers while the formal master and release encoder are unavailable."""

    def __init__(self, repository: StudioRepository, toolchain_lock_path: Path) -> None:
        self._repository = repository
        self._toolchain_lock_path = toolchain_lock_path

    def preflight(
        self,
        project_id: str,
        episode_id: str,
        payload: ProductExportPreflightRequest,
    ) -> ProductExportPreflightData:
        issues: list[ProductExportPreflightIssue] = []

        def block(code: str, scope: ProductExportIssueScope, message: str) -> None:
            issues.append(ProductExportPreflightIssue(code=code, scope=scope, message=message))

        project_exists = True
        try:
            self._repository.get_project(project_id)
        except ProjectNotFoundError:
            project_exists = False
            block("PROJECT_NOT_FOUND", "PROJECT", "The project is unavailable.")

        if project_exists:
            try:
                self._repository.get_episode(project_id, episode_id)
            except (EpisodeNotFoundError, ProjectNotFoundError):
                block("EPISODE_NOT_FOUND", "EPISODE", "The episode is unavailable in this project.")
        else:
            block("EPISODE_NOT_VERIFIED", "EPISODE", "The episode cannot be verified without its project.")

        if project_exists:
            try:
                record = self._repository.get_artifact_version(
                    project_id, "timeline", payload.timeline.version_id
                )
            except ArtifactConflictError:
                block("TIMELINE_NOT_FOUND", "TIMELINE", "The selected timeline version is unavailable.")
            else:
                if record.version.content_hash != payload.timeline.content_hash:
                    block("TIMELINE_HASH_CHANGED", "TIMELINE", "The selected timeline hash differs from storage.")
                try:
                    stored_content_hash = canonical_content_hash(record.version.content)
                except (TypeError, ValueError):
                    stored_content_hash = None
                if record.version.content_hash != stored_content_hash:
                    block("TIMELINE_CONTENT_INVALID", "TIMELINE", "The stored timeline content hash is invalid.")
                if (
                    record.head.latest_version_id != payload.timeline.version_id
                    or record.head.revision != payload.expected_revision
                ):
                    block("TIMELINE_HEAD_CHANGED", "TIMELINE", "The selected timeline is not the current head.")
                try:
                    timeline = TimelineVersionV1.model_validate(record.version.content)
                except ValueError:
                    block("TIMELINE_INVALID", "TIMELINE", "The stored timeline cannot be read safely.")
                else:
                    if timeline.revision != payload.expected_revision:
                        block("TIMELINE_REVISION_CHANGED", "TIMELINE", "The timeline revision differs from the request.")
                    rate = timeline.sequence_timebase.frame_rate
                    spec = payload.spec
                    if (
                        timeline.width != spec.width
                        or timeline.height != spec.height
                        or rate.num * spec.frame_rate_den != spec.frame_rate_num * rate.den
                    ):
                        block("SPEC_TIMELINE_MISMATCH", "SPEC", "Output geometry or frame rate differs from the timeline.")
                    if timeline.media_package is not None:
                        block("DEVELOPMENT_MEDIA_ONLY", "MEDIA", "Development Fake media cannot be a product master.")
        else:
            block("TIMELINE_NOT_VERIFIED", "TIMELINE", "The timeline cannot be verified without its project.")

        # Episode metadata currently does not partition creative artifacts. A client-supplied
        # version reference is never accepted as proof of an episode-owned formal master.
        block("EPISODE_TIMELINE_BINDING_MISSING", "EPISODE", "The timeline is not bound to an episode master.")
        self._unverified_ref(issues, payload.picture_lock, "PICTURE_LOCK")
        self._unverified_ref(issues, payload.media_manifest, "MEDIA")
        self._unverified_ref(issues, payload.video_master, "VIDEO")
        self._unverified_ref(issues, payload.dialogue_mix, "DIALOGUE")
        self._unverified_ref(issues, payload.bgm_mix, "BGM")
        self._unverified_ref(issues, payload.sfx_mix, "SFX")
        self._unverified_ref(issues, payload.subtitle_track, "SUBTITLE")
        self._unverified_ref(issues, payload.rights_clearance, "RIGHTS")

        block("OUTPUT_TARGET_NOT_SELECTED", "OUTPUT", "A desktop-controlled output target is not selected.")
        try:
            lock = load_media_toolchain_lock(self._toolchain_lock_path)
        except MediaToolchainError:
            block("TOOLCHAIN_LOCK_UNAVAILABLE", "TOOLCHAIN", "The media toolchain lock is unavailable.")
        else:
            if all(profile.distribution_status == "DEVELOPMENT_ONLY" for profile in lock.profiles):
                block("TOOLCHAIN_DEVELOPMENT_ONLY", "TOOLCHAIN", "Only development media tools are locked.")
            else:
                block("TOOLCHAIN_RELEASE_REVIEW_REQUIRED", "TOOLCHAIN", "Release approval is not recorded for the media toolchain.")
        block("PRODUCT_ENCODER_UNAVAILABLE", "EXECUTION", "The product export encoder is not release-approved.")
        block("EXPORT_OPERATION_UNAVAILABLE", "EXECUTION", "Durable progress, cancellation, and retry are not yet connected.")

        fingerprint = canonical_content_hash(
            {
                "project_id": project_id,
                "episode_id": episode_id,
                "request": payload.model_dump(mode="json"),
            }
        )
        return ProductExportPreflightData(
            status="BLOCKED",
            request_effect="NO_EXPORT_CLAIM",
            project_id=project_id,
            episode_id=episode_id,
            timeline=payload.timeline,
            expected_revision=payload.expected_revision,
            request_fingerprint=fingerprint,
            issues=tuple(issues),
        )

    @staticmethod
    def _unverified_ref(
        issues: list[ProductExportPreflightIssue],
        reference: object | None,
        scope: ProductExportIssueScope,
    ) -> None:
        code = f"{scope}_{'MISSING' if reference is None else 'UNVERIFIED'}"
        message = (
            f"No {scope.lower()} version was selected."
            if reference is None
            else f"The selected {scope.lower()} version is not verified for product export."
        )
        issues.append(ProductExportPreflightIssue(code=code, scope=scope, message=message))
