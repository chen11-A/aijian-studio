"""Immutable receipt shared by the one-call Sub2API store and worker.

Only the durable store issues a receipt after consuming the exact approval.
Its lease hash is rechecked before writing candidate or unknown outcomes.
"""

from dataclasses import dataclass

from aijian_api.provider_contracts import Sub2APIOriginMode
from aijian_api.task_ledger_models import ClaimedTask


@dataclass(frozen=True, slots=True)
class Sub2APIDispatchPermit:
    claim: ClaimedTask
    approval_id: str
    connection_id: str
    connection_revision: int
    model_id: str
    origin_hash: str
    origin_mode: Sub2APIOriginMode
    input_hash: str
    context_manifest_hash: str
    lease_token_hash: str
