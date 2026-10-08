from aijian_api.fault_injection import DeterministicFaultInjector


def test_fault_decisions_are_reproducible_and_occurrence_sensitive() -> None:
    first = DeterministicFaultInjector(seed=42)
    second = DeterministicFaultInjector(seed=42)

    observed = [
        first.should_inject("after_remote_submit", occurrence, rate=(1, 2))
        for occurrence in range(32)
    ]

    assert observed == [
        second.should_inject("after_remote_submit", occurrence, rate=(1, 2))
        for occurrence in range(32)
    ]
    assert any(observed)
    assert not all(observed)


def test_fault_decisions_validate_checkpoint_occurrence_and_rate() -> None:
    injector = DeterministicFaultInjector(seed=7)

    for checkpoint, occurrence, rate in [
        ("", 0, (1, 2)),
        ("submit", -1, (1, 2)),
        ("submit", True, (1, 2)),
        ("submit", 0, (0, 2)),
        ("submit", 0, (True, 2)),
        ("submit", 0, (3, 2)),
        ("submit", 0, (1, 0)),
    ]:
        try:
            injector.should_inject(checkpoint, occurrence, rate=rate)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid fault decision input was accepted")

    try:
        DeterministicFaultInjector(seed=True)  # type: ignore[arg-type]
    except ValueError:
        pass
    else:
        raise AssertionError("boolean fault seed was accepted")
