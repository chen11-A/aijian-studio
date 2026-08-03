# Artifact Envelope v0

## 目的

统一编剧、导演、美术、声音、剪辑和软件模块之间的交接。Envelope 记录的是“某个版本怎样产生、依据什么、改变什么、谁批准”，不是把所有领域字段塞进一个万能 JSON。

## 示例

```json
{
  "artifact_id": "art_01K...",
  "version_id": "ver_01K...",
  "artifact_type": "shot_intent",
  "schema_version": "0.1.0",
  "workspace_id": "ws_01K...",
  "project_id": "prj_01K...",
  "status": "needs_review",
  "created_at": "2026-08-03T12:00:00Z",
  "created_by": { "type": "agent", "id": "director.v1" },
  "inputs": [{ "version_id": "ver_scene_7", "relationship": "derived_from", "impact": "blocking" }],
  "source_spans": [
    { "source_block_id": "srcb_42", "start": 18, "end": 71, "claim": "character_action" }
  ],
  "content": {},
  "content_hash": "sha256:...",
  "change_summary": "将主观描述改成可执行的近景动作",
  "assumptions": ["此场景发生在日落前"],
  "open_questions": ["道具是否保留旧版裂纹"],
  "risks": [{ "code": "CONTINUITY_PROP", "severity": "warning" }],
  "generation": {
    "provider": "openai",
    "adapter_version": "0.1.0",
    "resolved_model": "configured-model",
    "input_hash": "sha256:...",
    "request_id": "provider-request-id",
    "parameters": {},
    "usage": {},
    "cost": { "currency": "USD", "reserved": "0.10", "accrued": "0.06" }
  },
  "approval": {
    "required_roles": ["producer", "director"],
    "decision": null,
    "decided_by": null,
    "decided_at": null,
    "waiver": null
  }
}
```

## 规则

- `artifact_id` 跨版本稳定；`version_id` 永不复用；内容修改必须产生新版本。
- `content_hash` 基于规范化序列化，缓存和幂等不得依赖显示名称。
- 输入必须指向确切版本，不只指向“当前角色”。
- `impact` 为 `blocking/advisory/render_only`，用于失效传播；依赖图必须无环。
- Schema 验证后立即写入不可变 `draft` 版本，批注和 Gate 引用其 `version_id`；审批通过追加 `ApprovalDecision` 并更新 `ArtifactHead.accepted_version_id`，版本内容和哈希不变。
- 状态至少为 `draft/needs_review/approved/approved_with_waiver/rejected/stale/superseded`；这些是生命周期投影，决定事件另存。
- `approved` 版本不可原地修改，但可通过新版本和 Change Request 取代；“不可变”不等于“永不删除”。
- 用户删除项目或执行合规清除后，可回收不再可达的版本和 Blob，并留下不含内容的审计墓碑（法律允许时）。
- 生成字段不得包含明文密钥、完整认证 Header、浏览器 Cookie 或短期签名 URL。
- 任何消费者都必须显式接受、拒绝或请求修订；不能默默补齐必填字段。

## 失效算法

1. 新版本提交后，比较语义字段和依赖类型，生成候选影响集合。
2. 在一个持久化操作中标记直接和传递下游为 `stale`，保留其内容与人工修改。
3. UI 向人展示“重基底、接受旧版、重新生成、扩大影响”选择。
4. 已批准但 stale 的版本默认阻断发布，只有具名 waiver 能继续。
5. 传播中断可按 operation ID 恢复，不重复修改或覆盖后代。
