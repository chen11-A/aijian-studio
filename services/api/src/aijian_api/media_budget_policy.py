"""Local budget arithmetic only; an assessment never authorizes dispatch."""

import re
from dataclasses import dataclass
from typing import Literal

MAX_MICRO_UNITS = 9_007_199_254_740_991
BudgetStatus = Literal[
    "WITHIN_LIMIT",
    "UNCONFIGURED",
    "UNKNOWN_AMOUNT",
    "CURRENCY_MISMATCH",
    "INCONSISTENT_USAGE",
    "PROJECT_LIMIT_EXCEEDED",
    "EPISODE_LIMIT_EXCEEDED",
]


def _check_currency(value: str) -> None:
    if not isinstance(value, str) or re.fullmatch(r"[A-Z]{3}", value) is None:
        raise ValueError("Budget currency must be an explicit three-letter uppercase identity")


def _check_micro(value: int) -> None:
    if type(value) is not int or not 0 <= value <= MAX_MICRO_UNITS:
        raise ValueError("Budget amounts must be nonnegative safe integers in micro units")


@dataclass(frozen=True, slots=True)
class BudgetAmount:
    currency: str
    micro_units: int

    def __post_init__(self) -> None:
        _check_currency(self.currency)
        _check_micro(self.micro_units)


@dataclass(frozen=True, slots=True)
class BudgetUsage:
    currency: str
    limit_micro: int
    spent_micro: int | None
    reserved_micro: int | None

    def __post_init__(self) -> None:
        _check_currency(self.currency)
        _check_micro(self.limit_micro)
        for value in (self.spent_micro, self.reserved_micro):
            if value is not None:
                _check_micro(value)
        if self.spent_micro is not None and self.reserved_micro is not None:
            _check_micro(self.spent_micro + self.reserved_micro)

    @property
    def available_micro(self) -> int | None:
        if self.spent_micro is None or self.reserved_micro is None:
            return None
        return self.limit_micro - self.spent_micro - self.reserved_micro


@dataclass(frozen=True, slots=True)
class BudgetAssessment:
    status: BudgetStatus
    project_available_micro: int | None
    episode_available_micro: int | None


def evaluate_media_budget(
    *, project: BudgetUsage | None, episode: BudgetUsage | None, request: BudgetAmount | None
) -> BudgetAssessment:
    """Assess a snapshot, not a permit, reservation, quote or provider cost guarantee.

    Project totals already include the episode. A future dispatch consumer must
    bind the scope/revision, obtain trustworthy cost bounds, and reserve inside
    its ledger transaction; a stale assessment alone must never permit a call.
    """
    project_available = project.available_micro if project is not None else None
    episode_available = episode.available_micro if episode is not None else None

    def result(status: BudgetStatus) -> BudgetAssessment:
        return BudgetAssessment(status, project_available, episode_available)

    if project is None:
        return result("UNCONFIGURED")
    if request is None:
        return result("UNKNOWN_AMOUNT")
    if request.currency != project.currency or (
        episode is not None and episode.currency != project.currency
    ):
        return result("CURRENCY_MISMATCH")
    if project_available is None or (episode is not None and episode_available is None):
        return result("UNKNOWN_AMOUNT")
    if episode is not None:
        # Known per-episode usage is a subset, never an independent second pot.
        assert episode.spent_micro is not None and episode.reserved_micro is not None
        assert project.spent_micro is not None and project.reserved_micro is not None
        if (
            episode.spent_micro > project.spent_micro
            or episode.reserved_micro > project.reserved_micro
        ):
            return result("INCONSISTENT_USAGE")
    if request.micro_units > project_available:
        return result("PROJECT_LIMIT_EXCEEDED")
    if episode_available is not None and request.micro_units > episode_available:
        return result("EPISODE_LIMIT_EXCEEDED")
    return result("WITHIN_LIMIT")
