"""Real SQLite restart/concurrency evidence; no network or provider invocation."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from aijian_api.generation_failure_store import GenerationFailureError, GenerationFailureStore
from aijian_api.repository import StudioRepository


def fixture(tmp_path):
    repository = StudioRepository(tmp_path / "workspace.db")
    project = repository.create_project(
        name="失败保护",
        aspect_ratio="16:9",
        target_duration_seconds=30,
        source_language="zh-CN",
    )
    return repository, project.id


def test_unconfigured_is_not_a_fabricated_allowance_and_zero_is_explicit(tmp_path):
    repository, project = fixture(tmp_path)
    store = GenerationFailureStore(repository)
    assert store.policy(project) is None
    with pytest.raises(GenerationFailureError, match="UNCONFIGURED"):
        store.reserve(project, input_sha256="a" * 64, attempt_key="one")
    assert store.configure(project, expected_revision=0, failure_limit=0).revision == 1
    with pytest.raises(GenerationFailureError, match="INPUT_FAILURE_LIMIT"):
        store.reserve(project, input_sha256="a" * 64, attempt_key="two")


def test_restart_new_key_unknown_and_failed_never_release_budget(tmp_path):
    repository, project = fixture(tmp_path)
    store = GenerationFailureStore(repository)
    store.configure(project, expected_revision=0, failure_limit=2)
    first = store.reserve(project, input_sha256="a" * 64, attempt_key="one")
    assert first is not None
    store.settle(project, first, "UNKNOWN")
    restarted = GenerationFailureStore(StudioRepository(repository.database_path))
    second = restarted.reserve(project, input_sha256="a" * 64, attempt_key="new-key")
    assert second is not None
    restarted.settle(project, second, "FAILED")
    with pytest.raises(GenerationFailureError, match="INPUT_FAILURE_LIMIT"):
        restarted.reserve(project, input_sha256="a" * 64, attempt_key="third-key")
    assert restarted.reserve(project, input_sha256="b" * 64, attempt_key="changed-input")


def test_parallel_reservations_are_atomic_and_crashed_pending_counts(tmp_path):
    repository, project = fixture(tmp_path)
    store = GenerationFailureStore(repository)
    store.configure(project, expected_revision=0, failure_limit=1)

    def reserve(index):
        try:
            return bool(
                GenerationFailureStore(repository).reserve(
                    project,
                    input_sha256="a" * 64,
                    attempt_key=f"key-{index}",
                )
            )
        except GenerationFailureError as error:
            assert str(error) == "INPUT_FAILURE_LIMIT"
            return False

    with ThreadPoolExecutor(max_workers=4) as executor:
        assert sum(executor.map(reserve, range(8))) == 1
    with pytest.raises(GenerationFailureError, match="INPUT_FAILURE_LIMIT"):
        store.reserve(project, input_sha256="a" * 64, attempt_key="after-crash")


def test_success_and_terminal_callbacks_policy_cas_and_replay(tmp_path):
    repository, project = fixture(tmp_path)
    store = GenerationFailureStore(repository)
    store.configure(project, expected_revision=0, failure_limit=1)
    first = store.reserve(project, input_sha256="a" * 64, attempt_key="one")
    assert first is not None
    store.settle(project, first, "SUCCEEDED")
    with pytest.raises(GenerationFailureError, match="ATTEMPT_NOT_PENDING"):
        store.settle(project, first, "UNKNOWN")
    with pytest.raises(GenerationFailureError, match="ATTEMPT_ALREADY_RESERVED"):
        store.reserve(project, input_sha256="a" * 64, attempt_key="one")
    assert store.reserve(project, input_sha256="a" * 64, attempt_key="two")
    with pytest.raises(GenerationFailureError, match="POLICY_CHANGED"):
        store.configure(project, expected_revision=0, failure_limit=10)
