"""Deterministic fault decisions shared by crash-recovery test harnesses."""

from dataclasses import dataclass
from hashlib import sha256


@dataclass(frozen=True, slots=True)
class DeterministicFaultInjector:
    """Map a seed and checkpoint occurrence to a stable Bernoulli decision."""

    seed: int

    def __post_init__(self) -> None:
        if type(self.seed) is not int:
            raise ValueError("fault seed must be an integer")

    def should_inject(
        self,
        checkpoint: str,
        occurrence: int,
        *,
        rate: tuple[int, int] = (1, 1),
    ) -> bool:
        if not checkpoint.strip():
            raise ValueError("fault checkpoint must not be empty")
        if type(occurrence) is not int or occurrence < 0:
            raise ValueError("fault occurrence must be a non-negative integer")
        numerator, denominator = rate
        if (
            type(numerator) is not int
            or type(denominator) is not int
            or denominator <= 0
            or numerator <= 0
            or numerator > denominator
        ):
            raise ValueError("fault rate must satisfy 0 < numerator <= denominator")
        material = f"aijian-fault-v1\0{self.seed}\0{checkpoint}\0{occurrence}".encode()
        bucket = int.from_bytes(sha256(material).digest()[:8], "big")
        return bucket % denominator < numerator
