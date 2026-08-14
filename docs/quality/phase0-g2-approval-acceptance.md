# Phase 0 Trusted G2 Approval Vertical Slice

范围：已绑定当前 accepted G1 的 StoryBible 草稿，经可信内部路由完成 prepare/submit/signoff/decision，推进 accepted StoryBible head。不包含 F05 下游失效传播。

## 行为

1. 仅在 `sidecar_security` 配置时注册内部 G2 路由，且排除在公共 OpenAPI 之外。
2. 身份、角色与能力只来自服务端 `TrustedReviewActor`；请求体拒绝 actor/role/capability/self-review/report hash/evidence revision/accepted-head 字段。
3. 每个 prepare/action 要求 `If-Match: "revision-{n}"`；成功响应返回当前成功 head 的 `ETag`。
4. 复用仓库审阅状态机：一次 submission、三次 `writer`/`continuity_reviewer`/`producer` 签署、一次 `producer` 终裁；批准后只推进 StoryBible accepted head 并清除 review head。
5. 每次 G2 prepare/action 都校验 blocking G1 仍是当前 accepted SourceManifest；G1 在 prepare 与 action 之间推进则整笔回滚，challenge 不消费。
6. `g2.story-bible` 对可证明的规范内容拒绝未解决 blocking question、未解决 core conflict，以及未处置的 core/supporting `ai_inference`。

## 证据

`services/api/tests/test_story_bible_g2_api.py` 与 `test_review_repository.py` 中的 G2 仓库测试；既有 G1 回归见 `test_source_manifest_api.py`。
