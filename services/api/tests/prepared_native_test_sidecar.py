"""Private test adapter: actual signed HTTP routes, synthetic provider transport only."""

import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

from aijian_api.generation_failure_store import GenerationFailureStore
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from aijian_api.story_film import StoryFilmService
from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from test_draft_export_runtime import toolchain
from test_story_film import TOKEN, _allow_live, _project


def main():
    root = Path(sys.argv[1])
    command = json.loads(sys.stdin.readline())
    if command["kind"] in {"init", "serve"}:
        repo, project = _project(root)
        GenerationFailureStore(repo).configure(project, expected_revision=0, failure_limit=10)
        GenerationFailureStore(repo, scope="story_creation").configure(
            project, expected_revision=0, failure_limit=1
        )
        if command["kind"] == "init":
            print(json.dumps({"projectId": project}))
            return
    repo = StudioRepository(root / "workspace.db")
    sent = []

    class Transport:
        def send(self, request):
            sent.append(urlsplit(request.url).path.rsplit("/", 1)[-1])
            raise OSError("synthetic provider response unavailable")

    class Consumer(StoryFilmService):
        def __init__(self, repository, tools):
            super().__init__(repository, toolchain, transport=Transport())

    with MonkeyPatch.context() as patch:
        _allow_live(patch, root / "private-status.log")
        patch.setattr("aijian_api.story_film_routes.StoryFilmService", Consumer)
        app = create_app(
            repository=repo,
            sidecar_security=SidecarSecurity(TOKEN, "127.0.0.1:51234"),
        )
        with TestClient(
            app, base_url="http://127.0.0.1:51234", client=("127.0.0.1", 12345)
        ) as client:

            def execute(value):
                sent.clear()
                response = client.post(
                    value["path"], content=value["body"].encode(), headers=value["headers"]
                )
                with repo._connection() as connection:
                    attempts = [
                        row[0]
                        for row in connection.execute(
                            "SELECT status FROM story_creation_failure_attempt"
                        )
                    ]
                print(
                    json.dumps(
                        {
                            "requestId": value.get("requestId"),
                            "requestSha256": hashlib.sha256(value["body"].encode()).hexdigest(),
                            "status": response.status_code,
                            "body": response.json(),
                            "sent": sent,
                            "attempts": attempts,
                        }
                    ),
                    flush=True,
                )

            if command["kind"] == "serve":
                print(json.dumps({"projectId": project}), flush=True)
                for line in sys.stdin:
                    execute(json.loads(line))
            else:
                execute(command)


if __name__ == "__main__":
    main()
