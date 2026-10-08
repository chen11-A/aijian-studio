"""Build one review-only V2 proposal from a bounded Sub2API text result."""

from __future__ import annotations

import hashlib
import json

from aijian_api.agent_skill_contracts import (
    ArtifactProposalV2,
    AttemptSnapshotV1,
    canonical_sha256,
)
from aijian_api.gateway_transport import GatewayTextSuccess
from aijian_api.source_extract_worker import FakeSourceExtractInvocationV1


def build_sub2api_source_extract_proposal(
    response: GatewayTextSuccess,
    invocation: FakeSourceExtractInvocationV1,
    snapshot: AttemptSnapshotV1,
    approval_id: str,
) -> ArtifactProposalV2:
    """Preserve source evidence and unknown charges; never accept the artifact."""
    if (
        invocation.attempt_id != snapshot.attempt_id
        or invocation.project_id != snapshot.project_id
        or invocation.agent_run_id != snapshot.agent_run_id
        or invocation.skill_run_id != snapshot.skill_run_id
        or response.model != snapshot.model_id
        or response.finish_reason != "stop"
        or len(response.text.encode("utf-8")) > 1024 * 1024
    ):
        raise ValueError("Sub2API response is incomplete or detached from the attempt")
    try:
        output = json.loads(response.text)
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("Sub2API response is not valid JSON") from error
    if not isinstance(output, dict) or set(output) != {"summary"}:
        raise ValueError("Sub2API response schema is invalid")
    summary = output["summary"]
    if not isinstance(summary, str) or not summary.strip() or len(summary) > 10_000:
        raise ValueError("Sub2API summary is invalid")
    identity = {
        "attempt_fingerprint": snapshot.attempt_fingerprint,
        "approval_id": approval_id,
        "response_id": response.response_id,
    }
    proposal_id = f"prp_{canonical_sha256({**identity, 'kind': 'proposal'})[7:39]}"
    claim_id = f"clm_{canonical_sha256({**identity, 'kind': 'claim'})[7:39]}"
    source_claim = "所选来源片段已用于生成待审阅摘要。"
    payload = {"summary": summary.strip()}
    quote_hash = "sha256:" + hashlib.sha256(invocation.excerpt.encode("utf-8")).hexdigest()
    return ArtifactProposalV2.model_validate(
        {
            "execution_provider": "SUB2API",
            "approval_id": approval_id,
            "proposal_id": proposal_id,
            "project_id": snapshot.project_id,
            "target_artifact_type": "SourceExtraction",
            "payload": payload,
            "payload_hash": canonical_sha256(payload),
            "source_spans": [
                {
                    "source_span_id": invocation.source_span_id,
                    "source_document_id": invocation.source_document_id,
                    "source_block_id": invocation.source_block_id,
                    "start_byte": invocation.start_byte,
                    "end_byte": invocation.end_byte,
                    "claim": source_claim,
                    "quote_hash": quote_hash,
                }
            ],
            "claims": [
                {
                    "claim_id": claim_id,
                    "text": source_claim,
                    "invented": False,
                    "source_span_ids": [invocation.source_span_id],
                }
            ],
            "diff": [{"op": "add", "path": "/summary", "value": summary.strip()}],
            "dependencies": [
                {
                    "artifact_type": "SourceManifest",
                    "version_id": invocation.source_manifest_version_id,
                    "approval_required": True,
                }
            ],
            "impacts": [{"artifact_type": "SourceExtraction", "impact": "CREATE"}],
            "cost": {
                "status": "UNKNOWN",
                "currency": None,
                "estimated_micros": None,
                "actual_micros": None,
                "upstream_status": "UNKNOWN",
                "upstream_actual_micros": None,
                "budget_enforcement": "UNENFORCED",
            },
            "confidence_basis_points": 0,
            "capability_losses": [],
            "qc": [
                {
                    "check_id": "source-extract.sub2api.schema",
                    "status": "PASS",
                    "details": (
                        "Provider JSON structure and frozen source span were checked; "
                        "factual accuracy and charges require separate review."
                    ),
                }
            ],
            "producer_agent_run_id": snapshot.agent_run_id,
            "producer_skill_run_id": snapshot.skill_run_id,
        }
    )
