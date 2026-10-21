"""No provider or store: exact checks for the confirmed local budget policy."""

from dataclasses import FrozenInstanceError

import pytest
from aijian_api.media_budget_policy import (
    MAX_MICRO_UNITS,
    BudgetAmount,
    BudgetUsage,
    evaluate_media_budget,
)


def test_episode_usage_is_already_inside_project_totals_and_is_not_double_counted():
    project = BudgetUsage("CNY", 100, 40, 10)
    episode = BudgetUsage("CNY", 60, 30, 10)
    result = evaluate_media_budget(
        project=project, episode=episode, request=BudgetAmount("CNY", 20)
    )
    assert result.status == "WITHIN_LIMIT"
    assert result.project_available_micro == 50
    assert result.episode_available_micro == 20
    assert project == BudgetUsage("CNY", 100, 40, 10)
    assert episode == BudgetUsage("CNY", 60, 30, 10)


@pytest.mark.parametrize(
    ("project_limit", "episode_limit", "requested_micro", "status"),
    [
        (100, 60, 20, "WITHIN_LIMIT"),
        (100, 60, 21, "EPISODE_LIMIT_EXCEEDED"),
        (70, 100, 20, "WITHIN_LIMIT"),
        (70, 100, 21, "PROJECT_LIMIT_EXCEEDED"),
        (0, 0, 0, "WITHIN_LIMIT"),
        (0, 0, 1, "PROJECT_LIMIT_EXCEEDED"),
    ],
)
def test_both_caps_apply_with_exact_inclusive_boundary(
    project_limit, episode_limit, requested_micro, status
):
    spent, reserved, episode_spent = (0, 0, 0) if project_limit == 0 else (40, 10, 30)
    result = evaluate_media_budget(
        project=BudgetUsage("USD", project_limit, spent, reserved),
        episode=BudgetUsage("USD", episode_limit, episode_spent, reserved),
        request=BudgetAmount("USD", requested_micro),
    )
    assert result.status == status


def test_optional_episode_cap_does_not_remove_project_cap():
    project = BudgetUsage("JPY", 100, 60, 30)
    assert (
        evaluate_media_budget(project=project, episode=None, request=BudgetAmount("JPY", 10)).status
        == "WITHIN_LIMIT"
    )
    assert (
        evaluate_media_budget(project=project, episode=None, request=BudgetAmount("JPY", 11)).status
        == "PROJECT_LIMIT_EXCEEDED"
    )


def test_no_project_budget_remains_unconfigured_even_with_an_episode_cap():
    result = evaluate_media_budget(
        project=None, episode=BudgetUsage("USD", 100, 0, 0), request=BudgetAmount("USD", 0)
    )
    assert result.status == "UNCONFIGURED"
    assert result.project_available_micro is None


def test_unknown_request_is_not_treated_as_zero():
    result = evaluate_media_budget(
        project=BudgetUsage("USD", 100, 0, 0), episode=None, request=None
    )
    assert result.status == "UNKNOWN_AMOUNT"


@pytest.mark.parametrize("scope", ["project", "episode"])
@pytest.mark.parametrize("field", ["spent_micro", "reserved_micro"])
def test_unknown_usage_blocks_even_when_the_request_is_zero(scope, field):
    fields = {"currency": "USD", "limit_micro": 100, "spent_micro": 0, "reserved_micro": 0}
    fields[field] = None
    unknown = BudgetUsage(**fields)
    known = BudgetUsage("USD", 100, 0, 0)
    result = evaluate_media_budget(
        project=unknown if scope == "project" else known,
        episode=unknown if scope == "episode" else known,
        request=BudgetAmount("USD", 0),
    )
    assert result.status == "UNKNOWN_AMOUNT"
    assert (
        result.project_available_micro if scope == "project" else result.episode_available_micro
    ) is None


@pytest.mark.parametrize("scope", ["episode", "request"])
def test_different_currencies_are_not_added_or_converted(scope):
    result = evaluate_media_budget(
        project=BudgetUsage("CNY", 100, 0, 0),
        episode=BudgetUsage("USD" if scope == "episode" else "CNY", 100, 0, 0),
        request=BudgetAmount("USD" if scope == "request" else "CNY", 1),
    )
    assert result.status == "CURRENCY_MISMATCH"


@pytest.mark.parametrize(("spent", "reserved"), [(11, 0), (0, 11)])
def test_episode_cannot_claim_more_usage_than_the_whole_project(spent, reserved):
    result = evaluate_media_budget(
        project=BudgetUsage("USD", 100, 10, 10),
        episode=BudgetUsage("USD", 100, spent, reserved),
        request=BudgetAmount("USD", 1),
    )
    assert result.status == "INCONSISTENT_USAGE"


def test_existing_overspend_remains_visible_and_blocks_even_a_zero_request():
    result = evaluate_media_budget(
        project=BudgetUsage("USD", 10, 20, 0), episode=None, request=BudgetAmount("USD", 0)
    )
    assert result.status == "PROJECT_LIMIT_EXCEEDED"
    assert result.project_available_micro == -10


def test_large_exact_integers_do_not_round_away_a_one_micro_unit_overrun():
    project = BudgetUsage("USD", MAX_MICRO_UNITS, MAX_MICRO_UNITS - 1, 0)
    assert (
        evaluate_media_budget(project=project, episode=None, request=BudgetAmount("USD", 1)).status
        == "WITHIN_LIMIT"
    )
    assert (
        evaluate_media_budget(project=project, episode=None, request=BudgetAmount("USD", 2)).status
        == "PROJECT_LIMIT_EXCEEDED"
    )


@pytest.mark.parametrize("amount", [-1, True, False, 0.5, "1", float("nan"), MAX_MICRO_UNITS + 1])
def test_request_rejects_invalid_money_instead_of_coercing(amount):
    with pytest.raises(ValueError):
        BudgetAmount("USD", amount)


@pytest.mark.parametrize("currency", ["usd", "US", "USDT", " USD", "USD\n", "人民币", None])
def test_currency_identity_is_explicit_and_not_guessed(currency):
    with pytest.raises(ValueError):
        BudgetAmount(currency, 1)
    with pytest.raises(ValueError):
        BudgetUsage(currency, 100, 0, 0)


@pytest.mark.parametrize("field", ["limit_micro", "spent_micro", "reserved_micro"])
@pytest.mark.parametrize("amount", [-1, True, 1.5, "2", MAX_MICRO_UNITS + 1])
def test_usage_rejects_invalid_amounts(field, amount):
    fields = {"currency": "USD", "limit_micro": 100, "spent_micro": 0, "reserved_micro": 0}
    fields[field] = amount
    with pytest.raises(ValueError):
        BudgetUsage(**fields)


def test_limit_cannot_be_unknown_inside_a_configured_budget():
    with pytest.raises(ValueError):
        BudgetUsage("USD", None, 0, 0)


def test_aggregate_usage_must_also_stay_in_the_safe_integer_range():
    with pytest.raises(ValueError):
        BudgetUsage("USD", MAX_MICRO_UNITS, MAX_MICRO_UNITS, 1)


def test_snapshot_is_immutable_and_assessment_has_no_dispatch_permission():
    project = BudgetUsage("USD", 100, 0, 0)
    with pytest.raises(FrozenInstanceError):
        project.limit_micro = 200
    result = evaluate_media_budget(project=project, episode=None, request=BudgetAmount("USD", 1))
    assert not hasattr(result, "dispatch_permit")
