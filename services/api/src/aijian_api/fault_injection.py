"""Deterministic kill-point helpers for executor recovery tests."""

import random
from dataclasses import dataclass
from enum import StrEnum


class KillPoint(StrEnum):
    AFTER_CLAIM = "after_claim"
    AFTER_MARK_RUNNING = "after_mark_running"
    BEFORE_HANDLER = "before_handler"
    AFTER_HANDLER_OUTPUT = "after_handler_output"
    BEFORE_COMPLETION = "before_completion"
    AFTER_COMPLETION = "after_completion"


class InjectedProcessCrash(RuntimeError):
    """Raised by test doubles to simulate abrupt worker death."""


@dataclass(frozen=True, slots=True)
class FaultInjector:
    kill_point: KillPoint | None = None

    def check(self, point: KillPoint) -> None:
        if self.kill_point == point:
            raise InjectedProcessCrash(f"injected crash at {point.value}")


def deterministic_kill_point(seed: int, points: tuple[KillPoint, ...] | None = None) -> KillPoint:
    candidates = points or tuple(KillPoint)
    if not candidates:
        raise ValueError("at least one kill point is required")
    return random.Random(seed).choice(candidates)
