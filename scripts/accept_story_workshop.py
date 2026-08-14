"""Capture reproducible browser evidence for the Phase 0 Story Workshop."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api" / "src"))


def validate_fixture(fixture: dict[str, Any]) -> None:
    """Fail before opening Chrome when the frozen boundary fixture drifts."""
    from aijian_api.contracts import (  # noqa: PLC0415
        ProjectListResponse,
        SourceDocumentListResponse,
        SourceDocumentResponse,
        SourceManifestResponse,
        StoryBibleIndexResponse,
        StoryBibleVersionResponse,
    )

    request_id = fixture["request_id"]
    ProjectListResponse.model_validate({"data": [fixture["project"]], "request_id": request_id})
    SourceDocumentListResponse.model_validate(
        {"data": fixture["source_summaries"], "request_id": request_id}
    )
    for source in fixture["sources"]:
        SourceDocumentResponse.model_validate({"data": source, "request_id": request_id})
    SourceManifestResponse.model_validate(fixture["manifest"])
    StoryBibleIndexResponse.model_validate(fixture["story_index"])
    StoryBibleVersionResponse.model_validate(fixture["story_version"])

    sources = {source["id"]: source for source in fixture["sources"]}
    manifest = fixture["manifest"]["data"]["accepted_version"]["content"]
    for document in manifest["documents"]:
        source = sources[document["source_document_id"]]
        if document["raw_sha256"] != source["raw_sha256"]:
            raise ValueError("manifest raw hash does not match its source document")
        source_blocks = {block["id"]: block for block in source["blocks"]}
        for block in document["blocks"]:
            source_block = source_blocks[block["source_block_id"]]
            if (block["start_byte"], block["end_byte"]) != (
                source_block["normalized_start_byte"],
                source_block["normalized_end_byte"],
            ):
                raise ValueError("manifest block coordinates do not match the source document")

    story_version = fixture["story_version"]["data"]["version"]
    story_scope = {
        document["source_document_id"]: document
        for document in story_version["content"]["source_scope"]["documents"]
    }
    for span in story_version["source_spans"]:
        source = sources[span["source_document_id"]]
        scoped = story_scope[span["source_document_id"]]
        block = next(item for item in source["blocks"] if item["id"] == span["source_block_id"])
        if block["id"] not in scoped["source_block_ids"]:
            raise ValueError("story span block is outside the frozen source scope")
        if not (
            block["normalized_start_byte"]
            <= span["start_byte"]
            < span["end_byte"]
            <= block["normalized_end_byte"]
        ):
            raise ValueError("story span coordinates are outside the bound source block")
        relative_start = span["start_byte"] - block["normalized_start_byte"]
        relative_end = span["end_byte"] - block["normalized_start_byte"]
        quote = block["text"].encode("utf-8")[relative_start:relative_end]
        quote.decode("utf-8", errors="strict")
        actual_hash = f"sha256:{hashlib.sha256(quote).hexdigest()}"
        if actual_hash != span["quote_hash"]:
            raise ValueError(f"story span quote hash mismatch: {span['id']}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:5173")
    parser.add_argument("--cdp-port", type=int, default=9333)
    parser.add_argument(
        "--fixture",
        type=Path,
        default=Path("docs/quality/evidence/story-workshop-fixture.json"),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("docs/quality/evidence"),
    )
    return parser.parse_args()


def payload_for(url: str, fixture: dict[str, Any]) -> dict[str, Any]:
    path = urllib.parse.urlparse(url).path
    request_id = fixture["request_id"]
    project = fixture["project"]
    project_id = project["id"]
    if path == "/api/v1/health":
        return {
            "data": {"status": "ok", "service": "aijian-api", "version": "0.1.0"},
            "request_id": request_id,
        }
    if path == "/api/v1/projects":
        return {"data": [project], "request_id": request_id}
    if path == f"/api/v1/projects/{project_id}":
        return {"data": project, "request_id": request_id}
    source_prefix = f"/api/v1/projects/{project_id}/sources/"
    if path.startswith(source_prefix):
        source_id = path.removeprefix(source_prefix)
        source = next((item for item in fixture["sources"] if item["id"] == source_id), None)
        if source is not None:
            return {"data": source, "request_id": request_id}
    if path == f"/api/v1/projects/{project_id}/sources":
        return {"data": fixture["source_summaries"], "request_id": request_id}
    if path == f"/api/v1/projects/{project_id}/source-manifest":
        return fixture["manifest"]
    story_version_prefix = f"/api/v1/projects/{project_id}/story-bible/versions/"
    if path.startswith(story_version_prefix):
        version_id = path.removeprefix(story_version_prefix)
        story_version = fixture["story_version"]
        if version_id == story_version["data"]["version"]["id"]:
            return story_version
    if path == f"/api/v1/projects/{project_id}/story-bible":
        return fixture["story_index"]
    return {
        "error": {
            "code": "NOT_FOUND",
            "message": "Acceptance mock route missing",
            "retryable": False,
            "details": {},
        },
        "request_id": request_id,
    }


class CdpSession:
    def __init__(self, websocket_url: str, fixture: dict[str, Any]) -> None:
        self.socket = connect(websocket_url, open_timeout=5)
        self.fixture = fixture
        self.sequence = 0
        self.console: list[dict[str, Any]] = []
        self.failed: list[dict[str, Any]] = []
        self.requests: list[dict[str, Any]] = []

    def _send_without_waiting(self, method: str, params: dict[str, Any]) -> None:
        self.sequence += 1
        self.socket.send(json.dumps({"id": self.sequence, "method": method, "params": params}))

    def _handle(self, message: dict[str, Any]) -> None:
        method = message.get("method")
        if method == "Fetch.requestPaused":
            params = message["params"]
            request = params["request"]
            payload = payload_for(request["url"], self.fixture)
            response_code = 404 if payload.get("error", {}).get("code") == "NOT_FOUND" else 200
            self.requests.append(
                {
                    "method": request["method"],
                    "url": request["url"],
                    "response_code": response_code,
                }
            )
            body = base64.b64encode(
                json.dumps(
                    payload,
                    ensure_ascii=False,
                ).encode()
            ).decode()
            self._send_without_waiting(
                "Fetch.fulfillRequest",
                {
                    "requestId": params["requestId"],
                    "responseCode": response_code,
                    "responseHeaders": [
                        {"name": "Content-Type", "value": "application/json; charset=utf-8"},
                        {"name": "Cache-Control", "value": "no-store"},
                    ],
                    "body": body,
                },
            )
        elif method == "Runtime.consoleAPICalled" and message.get("params", {}).get("type") in (
            "error",
            "warning",
        ):
            self.console.append(message)
        elif method in ("Runtime.exceptionThrown", "Log.entryAdded"):
            self.console.append(message)
        elif method == "Network.loadingFailed":
            self.failed.append(message.get("params", {}))

    def call(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        timeout: float = 10,
    ) -> dict[str, Any]:
        self.sequence += 1
        expected_id = self.sequence
        self.socket.send(json.dumps({"id": expected_id, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            message = json.loads(self.socket.recv(timeout=max(0.1, deadline - time.time())))
            if message.get("id") == expected_id:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message.get("result", {})
            self._handle(message)
        raise TimeoutError(method)

    def drain(self, seconds: float) -> None:
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                message = json.loads(
                    self.socket.recv(timeout=min(0.2, max(0.01, deadline - time.time())))
                )
            except TimeoutError:
                continue
            self._handle(message)

    def evaluate(self, expression: str) -> Any:
        return self.call(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True},
        )["result"].get("value")


def main() -> None:
    args = parse_args()
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    validate_fixture(fixture)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    target: dict[str, Any] | None = None
    cdp: CdpSession | None = None
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{args.cdp_port}/json/new?"
            f"{urllib.parse.quote(args.base_url, safe='')}",
            method="PUT",
        )
        with urllib.request.urlopen(request) as response:
            target = json.load(response)
        cdp = CdpSession(target["webSocketDebuggerUrl"], fixture)
        for domain in (
            "Page.enable",
            "Runtime.enable",
            "Log.enable",
            "Network.enable",
            "Accessibility.enable",
        ):
            cdp.call(domain)
        cdp.call("Fetch.enable", {"patterns": [{"urlPattern": "*api/v1*"}]})
        cdp.call("Page.navigate", {"url": args.base_url})
        cdp.drain(2)
        clicked = cdp.evaluate(
            "(()=>{const b=document.querySelector('.primary-nav button:nth-of-type(2)');"
            "if(!b)return false;b.click();return true})()"
        )
        cdp.drain(2)
        clicked_source_context = cdp.evaluate(
            "(()=>{const b=document.querySelector('.open-source-context');"
            "if(!b)return false;b.click();return true})()"
        )
        cdp.drain(1)

        viewports = []
        for width, height in ((1440, 900), (980, 680), (390, 844)):
            cdp.call(
                "Emulation.setDeviceMetricsOverride",
                {
                    "width": width,
                    "height": height,
                    "deviceScaleFactor": 1,
                    "mobile": width < 600,
                },
            )
            cdp.evaluate("window.scrollTo(0,0)")
            cdp.drain(0.4)
            metrics = cdp.evaluate(
                "({document:[document.documentElement.scrollWidth,"
                "document.documentElement.clientWidth,document.documentElement.scrollHeight],"
                "body:[document.body.scrollWidth,document.body.clientWidth],"
                "h1:[...document.querySelectorAll('h1')].map(e=>e.textContent.trim()),"
                "h2:[...document.querySelectorAll('h2')].map(e=>e.textContent.trim()),"
                "evidence:[...document.querySelectorAll('.fact-evidence blockquote')]"
                ".map(e=>e.textContent.trim()),"
                "sourceDocuments:[...document.querySelectorAll('.manifest-document-list button')]"
                ".map(e=>e.textContent.replace(/\\s+/g,' ').trim()),"
                "evidenceSource:[...document.querySelectorAll('.evidence-source-identity')]"
                ".map(e=>e.textContent.replace(/\\s+/g,' ').trim()),"
                "contextActions:[...document.querySelectorAll('.fact-evidence button')]"
                ".map(e=>e.textContent.replace(/\\s+/g,' ').trim()),"
                "activeSourceBlock:document.querySelector('.evidence-block.active p')"
                "?.textContent.trim(),"
                "activeVersion:document.querySelector('.artifact-version button.active span')"
                "?.textContent.trim(),"
                "reviewTouchTargets:[...document.querySelectorAll("
                "'.open-source-context,.conflict-facts button')]"
                ".map(e=>({height:e.getBoundingClientRect().height,"
                "fontSize:parseFloat(getComputedStyle(e).fontSize)})),"
                "disabledReview:[...document.querySelectorAll('button:disabled')]"
                ".some(e=>e.textContent.includes('G2'))})"
            )
            image = cdp.call(
                "Page.captureScreenshot",
                {"format": "png", "fromSurface": True, "captureBeyondViewport": False},
            )["data"]
            screenshot = args.output_dir / f"story-workshop-{width}x{height}.png"
            screenshot.write_bytes(base64.b64decode(image))
            viewports.append({"viewport": f"{width}x{height}", "metrics": metrics})

        cdp.call(
            "Emulation.setDeviceMetricsOverride",
            {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False},
        )
        cdp.evaluate(
            "document.querySelector('.evidence-block.active')?.scrollIntoView({block:'center'})"
        )
        cdp.drain(0.3)
        context_image = cdp.call(
            "Page.captureScreenshot",
            {"format": "png", "fromSurface": True, "captureBeyondViewport": False},
        )["data"]
        (args.output_dir / "story-workshop-context-1440x900.png").write_bytes(
            base64.b64decode(context_image)
        )
        cdp.evaluate(
            "document.activeElement?.blur();document.body.setAttribute('tabindex','-1');"
            "document.body.focus()"
        )
        focus_order = []
        for _ in range(40):
            for event_type in ("keyDown", "keyUp"):
                cdp.call(
                    "Input.dispatchKeyEvent",
                    {
                        "type": event_type,
                        "key": "Tab",
                        "code": "Tab",
                        "windowsVirtualKeyCode": 9,
                        "nativeVirtualKeyCode": 9,
                    },
                )
            focus_order.append(
                cdp.evaluate(
                    "({tag:document.activeElement?.tagName,"
                    "text:document.activeElement?.textContent?.trim().slice(0,80),"
                    "aria:document.activeElement?.getAttribute('aria-label')||"
                    "document.activeElement?.labels?.[0]?.textContent?.trim(),"
                    "current:document.activeElement?.getAttribute('aria-current'),"
                    "container:document.activeElement?.closest('.conflict-facts')?.className})"
                )
            )

        ax_nodes = cdp.call("Accessibility.getFullAXTree")["nodes"]
        accessibility = [
            {
                "role": node.get("role", {}).get("value"),
                "name": node.get("name", {}).get("value"),
            }
            for node in ax_nodes
            if node.get("role", {}).get("value") in ("heading", "button", "navigation", "searchbox")
        ]
        cdp.call(
            "Emulation.setEmulatedMedia",
            {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}]},
        )
        reduced_motion = cdp.evaluate(
            "({matches:matchMedia('(prefers-reduced-motion: reduce)').matches,"
            "maxAnimationMs:Math.max(0,...[...document.querySelectorAll('*')].flatMap(e=>"
            "getComputedStyle(e).animationDuration.split(',').map(v=>parseFloat(v)*"
            "(v.includes('ms')?1:1000)))),maxTransitionMs:Math.max(0,..."
            "[...document.querySelectorAll('*')].flatMap(e=>getComputedStyle(e)"
            ".transitionDuration.split(',').map(v=>parseFloat(v)*"
            "(v.includes('ms')?1:1000))))})"
        )
        meaningful_failures = [
            item
            for item in cdp.failed
            if not item.get("canceled") and item.get("errorText") != "net::ERR_ABORTED"
        ]
        result = {
            "clicked_story_workspace": clicked,
            "clicked_source_context": clicked_source_context,
            "viewports": viewports,
            "focus_order": focus_order,
            "accessibility": accessibility,
            "reduced_motion": reduced_motion,
            "api_requests": cdp.requests,
            "console_warning_error_count": len(cdp.console),
            "meaningful_network_failure_count": len(meaningful_failures),
        }
        output = args.output_dir / "story-workshop-results.json"
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result, ensure_ascii=True, indent=2))
        failures: list[str] = []
        if not clicked:
            failures.append("story workspace navigation was not clickable")
        if not clicked_source_context:
            failures.append("evidence source context navigation was not clickable")
        for viewport in viewports:
            metrics = viewport["metrics"]
            if metrics["document"][0] != metrics["document"][1]:
                failures.append(f"{viewport['viewport']} document has horizontal overflow")
            if metrics["body"][0] != metrics["body"][1]:
                failures.append(f"{viewport['viewport']} body has horizontal overflow")
            if "故事设定" not in metrics["h1"] or "人物与设定" not in metrics["h2"]:
                failures.append(f"{viewport['viewport']} is missing the story headings")
            if fixture["expected_evidence_quote"] not in metrics["evidence"]:
                failures.append(f"{viewport['viewport']} did not render the cross-document quote")
            for source in fixture["source_summaries"]:
                if not any(
                    source["filename"] in label and source["id"] in label
                    for label in metrics["sourceDocuments"]
                ):
                    failures.append(
                        f"{viewport['viewport']} did not identify source {source['filename']}"
                    )
            evidence_source = fixture["sources"][1]
            if not any(
                evidence_source["filename"] in label and evidence_source["id"] in label
                for label in metrics["evidenceSource"]
            ):
                failures.append(f"{viewport['viewport']} did not attribute evidence source")
            if not any(
                f"打开《{evidence_source['filename']}》上下文" in label
                for label in metrics["contextActions"]
            ):
                failures.append(f"{viewport['viewport']} did not expose source context navigation")
            if metrics["activeSourceBlock"] != fixture["expected_evidence_quote"].strip("“”"):
                failures.append(f"{viewport['viewport']} did not focus the cited source block")
            if viewport["viewport"] == "390x844" and any(
                target["height"] < 44 or target["fontSize"] < 12
                for target in metrics["reviewTouchTargets"]
            ):
                failures.append("390x844 review touch targets are smaller than 44px / 12px")
            if metrics["activeVersion"] != "最新稿":
                failures.append(f"{viewport['viewport']} selected the wrong story version")
            if not metrics["disabledReview"]:
                failures.append(f"{viewport['viewport']} exposed an enabled G2 action")
        if cdp.console:
            failures.append(f"browser emitted {len(cdp.console)} warning/error events")
        if meaningful_failures:
            failures.append(f"browser emitted {len(meaningful_failures)} network failures")
        story_index_path = f"/api/v1/projects/{fixture['project']['id']}/story-bible"
        story_version_path = (
            f"{story_index_path}/versions/{fixture['story_version']['data']['version']['id']}"
        )
        invalid_api_requests = [
            request
            for request in cdp.requests
            if request["method"] != "GET" or request["response_code"] != 200
        ]
        if invalid_api_requests:
            failures.append(f"unexpected API requests: {invalid_api_requests}")
        story_paths = [
            urllib.parse.urlparse(request["url"]).path
            for request in cdp.requests
            if "story-bible" in request["url"]
        ]
        if not 1 <= story_paths.count(story_index_path) <= 2:
            failures.append("story index request count exceeded the StrictMode allowance")
        if not 1 <= story_paths.count(story_version_path) <= 2:
            failures.append(
                "selected story version request count exceeded the StrictMode allowance"
            )
        if any(path not in {story_index_path, story_version_path} for path in story_paths):
            failures.append("an unselected story version was fetched eagerly")
        if not reduced_motion["matches"]:
            failures.append("prefers-reduced-motion did not match")
        if reduced_motion["maxAnimationMs"] > 0.01 or reduced_motion["maxTransitionMs"] > 0.01:
            failures.append("reduced-motion durations exceeded 0.01 ms")
        accessible_names = {item["name"] for item in accessibility}
        required_names = {
            "创作模块",
            "故事设定",
            "人物与设定",
            "来源预览",
            "原文依据",
            "人物与场景",
            "编剧审阅",
            "搜索人物或场景",
            "搜索事实",
        }
        missing_names = sorted(required_names - accessible_names)
        if missing_names:
            failures.append(f"AX tree is missing: {', '.join(missing_names)}")
        focus_labels = [
            f"{item.get('aria') or ''} {item.get('text') or ''}" for item in focus_order
        ]
        required_focus_fragments = (
            "故事设定",
            fixture["sources"][0]["filename"],
            fixture["sources"][1]["filename"],
            f"打开《{fixture['sources'][1]['filename']}》上下文",
            "搜索人物或场景",
            "搜索事实",
            "证据 1",
        )
        for fragment in required_focus_fragments:
            if not any(fragment in label for label in focus_labels):
                failures.append(f"keyboard path did not reach: {fragment}")
        if not any(item.get("container") == "conflict-facts" for item in focus_order):
            failures.append("keyboard path did not reach a conflict-linked fact")
        if failures:
            raise SystemExit("Story Workshop acceptance failed:\n- " + "\n- ".join(failures))
    finally:
        closed = False
        if cdp is not None and target is not None:
            try:
                close_result = cdp.call("Target.closeTarget", {"targetId": target["id"]}, timeout=2)
                closed = close_result.get("success") is True
            except Exception:
                pass
        if target is not None and not closed:
            close_url = f"http://127.0.0.1:{args.cdp_port}/json/close/{target['id']}"
            with urllib.request.urlopen(close_url, timeout=2) as response:
                response.read()
        if cdp is not None:
            cdp.socket.close()


if __name__ == "__main__":
    main()
