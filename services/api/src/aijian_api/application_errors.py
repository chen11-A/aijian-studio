"""Stable application-layer errors mapped at the HTTP composition root."""


class PreconditionRequiredError(RuntimeError):
    pass


class PreconditionFailedError(RuntimeError):
    pass


class StoryBiblePayloadTooLargeError(RuntimeError):
    pass


class StoryExtractPrerequisiteError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


class StoryExtractNotFoundError(LookupError):
    pass
