"""Schema 33: explicitly selected Sub2API origins and revision-safe metadata.

This is an independent reconstruction from the available contracts. Execute all
statements in one transaction with foreign keys temporarily disabled, validate
foreign_key_check before commit, and restore foreign keys even after rollback.
No credential bytes or network access are involved.
"""

from ipaddress import ip_network

from aijian_api.provider_credential_ref_schema import PROVIDER_CREDENTIAL_REF_MIGRATION

# Recreate the existing cross-table triggers verbatim after replacing their
# referenced table. Otherwise SQLite validates them against the temporarily
# absent table during ALTER TABLE. Their history table and other triggers stay.
_ROTATION_TRIGGER_NAMES = (
    "provider_credential_rotation_applied",
    "provider_credential_rotation_no_direct_delete",
)
_ROTATION_TRIGGERS = tuple(
    statement
    for statement in PROVIDER_CREDENTIAL_REF_MIGRATION
    if any(f"CREATE TRIGGER {name}\n" in statement for name in _ROTATION_TRIGGER_NAMES)
)

# A canonical decimal port is required in local mode, including no leading zero.
_LOCAL_PORT = """CASE
    WHEN substr(base_url, 1, 17) = 'http://127.0.0.1:' THEN substr(base_url, 18)
    WHEN substr(base_url, 1, 13) = 'http://[::1]:' THEN substr(base_url, 14)
    ELSE '' END"""


# Freeze network policy in persisted SQL rather than requiring a Python UDF on
# every writer. DNS answers are still independently checked by the transport.
_IPV4_NONPUBLIC = (
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/3",
)
_IPV4_PUBLIC_EXCEPTIONS = ("192.0.0.9/32", "192.0.0.10/32")
_IPV6_NONPUBLIC = (
    "::/128",
    "::1/128",
    "64:ff9b:1::/48",
    "100::/64",
    "2001::/23",
    "2001:db8::/32",
    "2002::/16",
    "3fff::/20",
    "fc00::/7",
    "fe80::/10",
    "ff00::/8",
) + tuple(f"::ffff:{cidr.split('/')[0]}/{96 + int(cidr.split('/')[1])}" for cidr in _IPV4_NONPUBLIC)
_IPV6_PUBLIC_EXCEPTIONS = (
    "2001:1::1/128",
    "2001:1::2/128",
    "2001:3::/32",
    "2001:4:112::/48",
    "2001:20::/28",
    "2001:30::/28",
    "::ffff:192.0.0.9/128",
    "::ffff:192.0.0.10/128",
)


def _network_condition(networks: tuple[str, ...], *, hexadecimal: bool = False) -> str:
    ranges = []
    for cidr in networks:
        network = ip_network(cidr)
        lower, upper = int(network.network_address), int(network.broadcast_address)
        ranges.append(
            f"value BETWEEN '{lower:032x}' AND '{upper:032x}'"
            if hexadecimal
            else f"value BETWEEN {lower} AND {upper}"
        )
    return " OR ".join(ranges)


def _public_origin_trigger(event: str) -> str:
    """Guard origin syntax without relying on connection-local SQLite UDFs.

    Public DNS resolution and global-address pinning remain transport checks;
    this persistent guard rejects malformed origins and local/private literals.
    """
    return f"""
    CREATE TRIGGER provider_connections_public_origin_{event.lower()}
    BEFORE {event} ON provider_connections_v33
    WHEN NEW.provider_kind = 'SUB2API' AND NEW.origin_mode = 'PUBLIC_HTTPS'
    BEGIN
        SELECT CASE WHEN (
            WITH RECURSIVE
            authority(value) AS (SELECT substr(NEW.base_url, 9)),
            parsed(host, port, bracketed) AS (
                SELECT
                    CASE WHEN substr(value, 1, 1) = '['
                         THEN lower(substr(value, 2, instr(value, ']') - 2))
                         WHEN instr(value, ':') > 0
                         THEN lower(substr(value, 1, instr(value, ':') - 1))
                         ELSE lower(value) END,
                    CASE WHEN substr(value, 1, 1) = '['
                         THEN substr(value, instr(value, ']') + 1)
                         WHEN instr(value, ':') > 0
                         THEN substr(value, instr(value, ':'))
                         ELSE '' END,
                    substr(value, 1, 1) = '['
                FROM authority
            ),
            octets(part, rest, position) AS (
                SELECT '', CASE WHEN bracketed
                    THEN substr(host, length(rtrim(host, '0123456789.')) + 1)
                    ELSE host END || '.', 0 FROM parsed
                UNION ALL
                SELECT substr(rest, 1, instr(rest, '.') - 1),
                       substr(rest, instr(rest, '.') + 1), position + 1
                FROM octets WHERE rest != '' AND position < 5
            ),
            ipv4(value, valid) AS (
                SELECT sum(CAST(part AS INTEGER) * CASE position
                    WHEN 1 THEN 16777216 WHEN 2 THEN 65536 WHEN 3 THEN 256 ELSE 1 END),
                    count(*) = 4 AND min(
                        length(part) BETWEEN 1 AND 3
                        AND part NOT GLOB '*[^0-9]*'
                        AND CAST(part AS INTEGER) BETWEEN 0 AND 255
                        AND CAST(CAST(part AS INTEGER) AS TEXT) = part
                    )
                FROM octets WHERE position > 0
            ),
            hextets(part, rest, position) AS (
                SELECT '', trim(replace(
                    CASE WHEN instr(host, '.') > 0 THEN
                        substr(host, 1, length(rtrim(host, '0123456789.')))
                        || (SELECT printf('%x:%x', value / 65536, value % 65536) FROM ipv4)
                    ELSE host END, '::', ':Z:'), ':') || ':', 0 FROM parsed
                UNION ALL
                SELECT substr(rest, 1, instr(rest, ':') - 1),
                       substr(rest, instr(rest, ':') + 1), position + 1
                FROM hextets WHERE rest != '' AND position < 9
            ),
            ipv6(value, valid) AS (
                SELECT group_concat(
                    CASE WHEN part = 'Z' THEN
                        substr('00000000000000000000000000000000', 1,
                               (9 - (SELECT count(*) FROM hextets WHERE position > 0)) * 4)
                    ELSE substr('0000' || part, -4) END, ''),
                    min(part = 'Z' OR (length(part) BETWEEN 1 AND 4
                        AND part NOT GLOB '*[^0-9a-f]*'))
                    AND ((sum(part = 'Z') = 0 AND count(*) = 8)
                        OR (sum(part = 'Z') = 1 AND count(*) BETWEEN 1 AND 8))
                FROM (SELECT part FROM hextets WHERE position > 0 ORDER BY position)
            )
            SELECT NOT (
                length(host) > 0
                AND (port = '' OR (
                    substr(port, 1, 1) = ':'
                    AND length(substr(port, 2)) BETWEEN 1 AND 5
                    AND substr(port, 2) NOT GLOB '*[^0-9]*'
                    AND CAST(substr(port, 2) AS INTEGER) BETWEEN 1 AND 65535
                ))
                AND CASE WHEN bracketed THEN
                    instr((SELECT value FROM authority), ']') > 2
                    AND host NOT GLOB '*[^0-9a-f:.]*'
                    AND (instr(host, '.') = 0 OR (SELECT valid FROM ipv4))
                    AND instr(host, ':') > 0
                    AND instr(host, ':::') = 0
                    AND (substr(host, 1, 1) != ':' OR substr(host, 1, 2) = '::')
                    AND (substr(host, -1) != ':' OR substr(host, -2) = '::')
                    AND (SELECT valid AND length(value) = 32 AND (
                        NOT ({_network_condition(_IPV6_NONPUBLIC, hexadecimal=True)})
                        OR ({_network_condition(_IPV6_PUBLIC_EXCEPTIONS, hexadecimal=True)})
                    ) FROM ipv6)
                WHEN host NOT GLOB '*[^0-9.]*' THEN
                    (SELECT valid AND (
                        NOT ({_network_condition(_IPV4_NONPUBLIC)})
                        OR ({_network_condition(_IPV4_PUBLIC_EXCEPTIONS)})
                    ) FROM ipv4)
                ELSE
                    instr(host, '.') > 1
                    AND substr(host, -1) != '.'
                    AND instr(host, '..') = 0
                    AND host NOT GLOB '*[^a-z0-9.' || char(128) || '-' || char(1114111) || '-]*'
                    AND host != 'localhost'
                    AND host NOT GLOB '*.localhost'
                END
            ) FROM parsed
        ) THEN RAISE(ABORT, 'Sub2API requires a public HTTPS origin') END;
    END
    """


PROVIDER_ORIGIN_MODE_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE provider_connections_v33 (
        connection_id TEXT PRIMARY KEY NOT NULL,
        provider_kind TEXT NOT NULL CHECK (
            provider_kind IN (
                'OPENAI', 'XAI', 'OPENAI_COMPATIBLE', 'OLLAMA', 'CPA_LOOPBACK', 'SUB2API'
            )
        ),
        display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
        base_url TEXT NOT NULL CHECK (length(base_url) BETWEEN 1 AND 2048),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        models_json TEXT NOT NULL CHECK (json_valid(models_json)),
        revision INTEGER NOT NULL CHECK (
            typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9223372036854775807
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        credential_ref TEXT NOT NULL CHECK (
            credential_ref = connection_id
            OR (
                length(connection_id) = 36
                AND substr(connection_id, 1, 4) = 'pcn_'
                AND substr(connection_id, 5) NOT GLOB '*[^0-9a-f]*'
                AND length(credential_ref) = 73
                AND substr(credential_ref, 1, 41) = connection_id || ':crd_'
                AND substr(credential_ref, 42) NOT GLOB '*[^0-9a-f]*'
            )
        ),
        origin_mode TEXT,
        CHECK (provider_kind <> 'CPA_LOOPBACK' OR base_url = 'http://127.0.0.1:8317'),
        CHECK (
            (provider_kind = 'SUB2API' AND origin_mode IS NOT NULL
                AND origin_mode IN ('PUBLIC_HTTPS', 'LOCAL_LOOPBACK_HTTP'))
            OR (provider_kind <> 'SUB2API' AND origin_mode IS NULL)
        ),
        CHECK (provider_kind <> 'SUB2API' OR (
            instr(base_url, char(0)) = 0
            AND base_url NOT GLOB '*[' || char(1) || '-' || char(32) || char(127) || ']*'
            AND instr(base_url, char(133)) = 0
            AND instr(base_url, char(160)) = 0
            AND instr(base_url, char(5760)) = 0
            AND base_url NOT GLOB '*[' || char(8192) || '-' || char(8202) || ']*'
            AND instr(base_url, char(8232)) = 0
            AND instr(base_url, char(8233)) = 0
            AND instr(base_url, char(8239)) = 0
            AND instr(base_url, char(8287)) = 0
            AND instr(base_url, char(12288)) = 0
            AND instr(base_url, '@') = 0
            AND instr(base_url, '?') = 0
            AND instr(base_url, '#') = 0
            AND instr(base_url, '\\') = 0
            AND instr(base_url, '%') = 0
            AND (origin_mode <> 'PUBLIC_HTTPS' OR (
                substr(base_url, 1, 8) = 'https://'
                AND length(base_url) > 8
                AND instr(substr(base_url, 9), '/') = 0
            ))
        )),
    """
    + f"""
        CHECK (origin_mode IS NOT 'LOCAL_LOOPBACK_HTTP' OR (
            length(({_LOCAL_PORT})) BETWEEN 1 AND 5
            AND ({_LOCAL_PORT}) NOT GLOB '*[^0-9]*'
            AND CAST(({_LOCAL_PORT}) AS INTEGER) BETWEEN 1 AND 65535
            AND CAST(CAST(({_LOCAL_PORT}) AS INTEGER) AS TEXT) = ({_LOCAL_PORT})
        ))
    )
    """,
    _public_origin_trigger("INSERT"),
    _public_origin_trigger("UPDATE"),
    """
    INSERT INTO provider_connections_v33 (
        connection_id, provider_kind, display_name, base_url, enabled,
        models_json, revision, created_at, updated_at, credential_ref, origin_mode
    )
    SELECT connection_id, provider_kind, display_name, base_url, enabled,
           models_json, revision, created_at, updated_at, credential_ref,
           CASE WHEN provider_kind = 'SUB2API' THEN 'PUBLIC_HTTPS' ELSE NULL END
    FROM provider_connections
    """,
    *(f"DROP TRIGGER {name}" for name in _ROTATION_TRIGGER_NAMES),
    "DROP TABLE provider_connections",
    "ALTER TABLE provider_connections_v33 RENAME TO provider_connections",
    """
    CREATE UNIQUE INDEX provider_connections_name_unique
    ON provider_connections(lower(display_name))
    """,
    """
    CREATE UNIQUE INDEX provider_connections_credential_ref_unique
    ON provider_connections(credential_ref)
    """,
    *_ROTATION_TRIGGERS,
    """
    CREATE TRIGGER provider_connections_identity_immutable
    BEFORE UPDATE ON provider_connections
    WHEN NEW.connection_id IS NOT OLD.connection_id
      OR NEW.provider_kind IS NOT OLD.provider_kind
      OR NEW.created_at IS NOT OLD.created_at
    BEGIN SELECT RAISE(ABORT, 'provider connection identity is immutable'); END
    """,
    """
    CREATE TRIGGER provider_connections_revision_increments_once
    BEFORE UPDATE ON provider_connections
    WHEN NEW.revision IS NOT OLD.revision + 1
    BEGIN SELECT RAISE(ABORT, 'provider connection revision must increment exactly once'); END
    """,
)


def migration_33_statements() -> tuple[str, ...]:
    """Return the atomic origin-mode upgrade, with no implicit transaction commits."""
    return PROVIDER_ORIGIN_MODE_MIGRATION
