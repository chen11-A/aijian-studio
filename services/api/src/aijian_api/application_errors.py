"""Stable application-layer errors mapped at the HTTP composition root."""


class PreconditionRequiredError(RuntimeError):
    pass


class PreconditionFailedError(RuntimeError):
    pass


class StoryBiblePayloadTooLargeError(RuntimeError):
    pass


class ProposalRunNotFoundError(LookupError):
    pass
