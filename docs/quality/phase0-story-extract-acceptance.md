# Phase 0 `story.extract` 纵切验收

范围：已验收 G1 SourceManifest 入队为持久化 `story.extract` 任务，经 LocalExecutor + FakeProvider 生成一份不可变 StoryBible 草稿。不包含 StoryBible 编辑器或真实供应商。

## 行为

1. `POST /api/v1/projects/{project_id}/story-extract` 只入队。缺少、未验收或非当前 accepted 的 G1 返回 `G1_MISSING` / `G1_UNACCEPTED` / `G1_STALE`，不写任务或产物。
2. 执行读取该不可变 manifest 版本及其文档、hash、块、章节范围与排除项，构造 `TextProviderRequest`，并复用现有 Provider Runtime 校验。
3. 成功时写入恰好一个 StoryBible 草稿版本、精确 SourceSpan、对 accepted SourceManifest 的 blocking `derived_from` 依赖，以及 `producer_attempt_id`。
4. 同一项目 + accepted manifest + 抽取输入幂等；过期租约可恢复且不重复写 Artifact。
5. FakeProvider `REMOTE_UNKNOWN` 将 Node 置为 `RECONCILIATION_REQUIRED`，Attempt 以 `retry_disposition=REMOTE_UNKNOWN` 失败，不回到 READY，也不自动重提。远程 Attempt 状态 `REMOTE_UNKNOWN` 仍只用于 remote 执行模式。

## 证据

`services/api/tests/test_story_extract.py`、`test_story_extract_api.py` 与 LocalExecutor 的 `REMOTE_UNKNOWN` 租约测试。
