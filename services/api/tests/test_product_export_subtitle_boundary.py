"""Literal DRAFT cues cannot widen the separately closed formal export path."""

import pytest
from aijian_api.episode_media_assembly_contracts import (
    AssemblySubtitleSegmentV1,
    EpisodeMediaAssemblyContentV1,
)
from aijian_api.product_export_claim import (
    ProductExportClaimError,
    _formal_script_subtitles,
    require_release_profile_configured,
)
from test_draft_export_runtime import fixture


def test_formal_consumer_rejects_literal_cues_without_dropping_or_claiming(tmp_path):
    repository, _project, _episode, _asset, assembly = fixture(tmp_path)
    literal = {
        "segment_id": "seg_literal",
        "start_frame": 3,
        "end_frame": 10,
        "text": "真实草稿字幕",
        "render_profile": "noto-cjk-sc-bottom-v1",
    }
    content = EpisodeMediaAssemblyContentV1.model_validate(
        {
            **assembly.content.model_dump(mode="json"),
            "subtitle_segments": [literal],
        }
    )
    with pytest.raises(ProductExportClaimError, match="DRAFT-only") as error:
        _formal_script_subtitles(content)
    assert error.value.code == "SUBTITLE_UNSUPPORTED"
    assert content.subtitle_segments[0].model_dump() == literal
    with repository._connection() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM product_export_operations").fetchone()[0] == 0
        )
        assert (
            connection.execute("SELECT COUNT(*) FROM product_export_subtitle_inputs").fetchone()[0]
            == 0
        )
    # The actual formal release allowlist is still closed before source admission.
    with pytest.raises(ProductExportClaimError) as release:
        require_release_profile_configured()
    assert release.value.code == "RELEASE_TOOLCHAIN_NOT_APPROVED"


def test_formal_type_boundary_preserves_empty_and_legacy_inputs(tmp_path):
    _repository, _project, _episode, _asset, assembly = fixture(tmp_path)
    assert _formal_script_subtitles(assembly.content) == ()
    legacy = AssemblySubtitleSegmentV1(
        segment_id="seg_legacy",
        script_version_id="ver_" + "1" * 32,
        script_block_id="sblk_" + "2" * 32,
        start_frame=0,
        end_frame=12,
    )
    content = assembly.content.model_copy(update={"subtitle_segments": (legacy,)})
    assert _formal_script_subtitles(content) == (legacy,)
    # This helper narrows ledger input types only. claim() retains the existing
    # unconditional SUBTITLE_UNSUPPORTED rejection for every nonempty legacy tuple.
