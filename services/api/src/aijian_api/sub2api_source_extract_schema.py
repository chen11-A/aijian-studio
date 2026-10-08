"""Version 23: evidence for one consented Sub2API source extraction call.

The workflow ledger remains the task truth and agent_artifact_proposals remains
the only proposal truth. These rows only freeze scope, consent, consumption and
the observation of an external call.
"""


def migration_23_statements() -> tuple[str, ...]:
    return (
        """
        CREATE TABLE sub2api_source_extract_scopes (
            task_id TEXT PRIMARY KEY REFERENCES task_ledger(task_id) ON DELETE CASCADE,
            attempt_id TEXT NOT NULL UNIQUE
                REFERENCES workflow_attempts(attempt_id) ON DELETE CASCADE,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            scope_json TEXT NOT NULL CHECK (json_valid(scope_json) AND length(scope_json) <= 32768),
            scope_hash TEXT NOT NULL CHECK (length(scope_hash) = 71 AND scope_hash LIKE 'sha256:%'),
            connection_id TEXT NOT NULL REFERENCES provider_connections(connection_id),
            connection_revision INTEGER NOT NULL CHECK (connection_revision >= 1),
            model_id TEXT NOT NULL,
            origin_hash TEXT NOT NULL CHECK (length(origin_hash) = 71 AND origin_hash LIKE 'sha256:%'),
            input_hash TEXT NOT NULL CHECK (length(input_hash) = 71 AND input_hash LIKE 'sha256:%'),
            context_manifest_hash TEXT NOT NULL
                CHECK (length(context_manifest_hash) = 71 AND context_manifest_hash LIKE 'sha256:%'),
            attempt_fingerprint TEXT NOT NULL
                CHECK (length(attempt_fingerprint) = 71 AND attempt_fingerprint LIKE 'sha256:%'),
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE sub2api_call_approvals (
            approval_id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL UNIQUE REFERENCES sub2api_source_extract_scopes(task_id),
            attempt_id TEXT NOT NULL UNIQUE REFERENCES sub2api_source_extract_scopes(attempt_id),
            project_id TEXT NOT NULL REFERENCES projects(id),
            approval_json TEXT NOT NULL CHECK (json_valid(approval_json) AND length(approval_json) <= 16384),
            approval_hash TEXT NOT NULL CHECK (length(approval_hash) = 71 AND approval_hash LIKE 'sha256:%'),
            idempotency_key_hash TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            approved_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            revoked_at TEXT,
            UNIQUE (project_id, idempotency_key_hash)
        )
        """,
        """
        CREATE TABLE sub2api_call_consumptions (
            attempt_id TEXT PRIMARY KEY REFERENCES sub2api_source_extract_scopes(attempt_id),
            task_id TEXT NOT NULL UNIQUE REFERENCES sub2api_source_extract_scopes(task_id),
            approval_id TEXT NOT NULL UNIQUE REFERENCES sub2api_call_approvals(approval_id),
            lease_generation INTEGER NOT NULL CHECK (lease_generation >= 1),
            lease_token_hash TEXT NOT NULL CHECK (length(lease_token_hash) = 71 AND lease_token_hash LIKE 'sha256:%'),
            consumed_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE sub2api_call_observations (
            attempt_id TEXT PRIMARY KEY REFERENCES sub2api_call_consumptions(attempt_id),
            status TEXT NOT NULL CHECK (status IN ('REMOTE_UNKNOWN', 'PROPOSAL_READY')),
            provider_response_id TEXT CHECK (provider_response_id IS NULL OR length(provider_response_id) BETWEEN 1 AND 512),
            raw_output_sha256 TEXT CHECK (
                raw_output_sha256 IS NULL OR
                (length(raw_output_sha256) = 71 AND raw_output_sha256 LIKE 'sha256:%')
            ),
            response_content_type TEXT CHECK (
                response_content_type IS NULL OR response_content_type = 'application/json'
            ),
            raw_response_body BLOB CHECK (
                raw_response_body IS NULL OR
                (typeof(raw_response_body) = 'blob' AND length(raw_response_body) BETWEEN 1 AND 1048576)
            ),
            raw_response_sha256 TEXT CHECK (
                raw_response_sha256 IS NULL OR
                (length(raw_response_sha256) = 71 AND raw_response_sha256 LIKE 'sha256:%')
            ),
            usage_tokens_json TEXT CHECK (
                usage_tokens_json IS NULL OR
                (json_valid(usage_tokens_json) AND length(usage_tokens_json) <= 128)
            ),
            proposal_id TEXT UNIQUE REFERENCES agent_artifact_proposals(proposal_id),
            code TEXT,
            observed_at TEXT NOT NULL,
            CHECK ((status = 'PROPOSAL_READY') = (proposal_id IS NOT NULL)),
            CHECK (status <> 'PROPOSAL_READY' OR (
                provider_response_id IS NOT NULL AND raw_output_sha256 IS NOT NULL
                AND response_content_type = 'application/json'
                AND raw_response_body IS NOT NULL AND raw_response_sha256 IS NOT NULL
            )),
            CHECK (status <> 'REMOTE_UNKNOWN' OR (
                proposal_id IS NULL AND raw_output_sha256 IS NULL
                AND raw_response_body IS NULL AND raw_response_sha256 IS NULL
                AND usage_tokens_json IS NULL
            ))
        )
        """,
        """
        CREATE TRIGGER sub2api_source_extract_scopes_immutable_update
        BEFORE UPDATE ON sub2api_source_extract_scopes
        BEGIN SELECT RAISE(ABORT, 'Sub2API scope is immutable'); END
        """,
        """
        CREATE TRIGGER sub2api_call_consumptions_immutable_update
        BEFORE UPDATE ON sub2api_call_consumptions
        BEGIN SELECT RAISE(ABORT, 'Sub2API consume is immutable'); END
        """,
        """
        CREATE TRIGGER sub2api_call_observations_immutable_update
        BEFORE UPDATE ON sub2api_call_observations
        BEGIN SELECT RAISE(ABORT, 'Sub2API observation is immutable'); END
        """,
    )
