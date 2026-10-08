"""Version 25: one local user's non-sensitive application preferences."""


def migration_25_statements() -> tuple[str, ...]:
    return (
        """
        CREATE TABLE app_preferences (
            preference_id TEXT PRIMARY KEY CHECK (preference_id = 'local-user'),
            user_name TEXT NOT NULL CHECK (length(user_name) BETWEEN 1 AND 80),
            display_bio TEXT NOT NULL CHECK (length(display_bio) <= 1000),
            ui_language TEXT NOT NULL CHECK (ui_language = 'zh-CN'),
            ui_theme TEXT NOT NULL CHECK (ui_theme = 'dark-cinematic'),
            revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9223372036854775807),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
    )
