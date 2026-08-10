from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SPEC = ROOT / "docs/specs/settings-center-v1.md"
ADR = ROOT / "docs/architecture/ADR-0006-settings-scope-and-effective-values.md"
MATRIX = ROOT / "docs/research/settings-open-source-patterns-2026-08.md"
ACCEPTANCE = ROOT / "docs/quality/settings-center-spec-acceptance.md"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_settings_spec_freezes_scopes_and_effective_value_contract() -> None:
    text = _read(SPEC)

    for required in (
        "### A. 全局设置中心",
        "### B. 项目设置",
        "### C. 领域与镜头设置",
        '"desired"',
        '"effective"',
        '"revision"',
        "CredentialRef",
        "REMOTE_UNKNOWN",
        "exact whitelist",
        "390px",
    ):
        assert required in text

    assert "不会创建设置表、API、Electron IPC、可点击开关或真实连接测试" in text

    expected_sections = {
        "general": "WORKSPACE",
        "model_api": "WORKSPACE",
        "agent_skill": "WORKSPACE",
        "generation_cost": "WORKSPACE",
        "storage_media": "WORKSPACE",
        "privacy_security": "WORKSPACE",
        "notification_task": "WORKSPACE",
        "about_diagnostics": "WORKSPACE",
        "project_production": "PROJECT",
    }
    for section_id, scope in expected_sections.items():
        row = next(line for line in text.splitlines() if line.startswith(f"| {section_id}"))
        assert f"| {scope}" in row
    assert "SCOPE_SECTION_MISMATCH" in text


def test_settings_spec_records_security_and_delivery_gates() -> None:
    combined = "\n".join(_read(path) for path in (SPEC, ADR, ACCEPTANCE))

    for required in (
        "SSRF",
        "DNS rebinding",
        "固定到已校验地址",
        "核对实际 peer",
        "TLS SNI",
        "重定向",
        "私网",
        "Schema → repository → API/OpenAPI → Web transport → Electron exact whitelist → UI",
        "没有真实后端能力时，不得先放可点击开关",
    ):
        assert required in combined


def test_open_source_matrix_records_all_sources_and_boundaries() -> None:
    text = _read(MATRIX)

    expected_sources = {
        "LumenX": ("MIT", "Adapt"),
        "LocalMiniDrama": ("MIT", "Adapt"),
        "ArcReel": ("AGPL-3.0", "Absorb behavior / Reject code"),
        "Toonflow": ("Apache-2.0", "Adapt IA / Reject unsafe behavior"),
        "PrintFilm": ("未提供明确许可证文件", "Adapt concepts / Reject code"),
        "Jellyfish": ("Apache-2.0", "Absorb principle"),
    }
    table_rows = [line for line in text.splitlines() if line.startswith("| [")]
    for source, (license_text, decision) in expected_sources.items():
        row = next(line for line in table_rows if source in line)
        assert license_text in row
        assert decision in row
        assert len(row.split("|")) == 8

    assert "代码边界" in text
    assert "许可证" in text

    assert "没有复制上游源码" in text
