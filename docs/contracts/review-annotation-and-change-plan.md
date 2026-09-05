# ReviewRound / ReviewAnnotation / ChangePlan 契约 v0

状态：Draft v0，随 ADR-0006 冻结字段名；具体 JSON Schema 在实施 Issue 中版本化为 `schema://review-round/v0` 等。  
时间值遵守 [ADR-0003](../architecture/ADR-0003-timeline-timebase.md)：禁止浮点秒。  
交接遵守 [Artifact Envelope](./artifact-envelope.md)：Agent 只提交 Proposal，程序写入不可变版本。

## 1. ReviewRound

一轮从开始看片到“审核完成”的批注集合。

```json
{
  "artifact_type": "review_round",
  "round_id": "rr_01K...",
  "project_id": "prj_01K...",
  "episode_id": "ep_01K...",
  "timeline_version_id": "ver_tl_01K...",
  "status": "collecting",
  "opened_by": {"type": "user", "id": "usr_01K..."},
  "opened_at": "2026-09-05T12:00:00Z",
  "closed_at": null,
  "change_plan_version_id": null,
  "annotation_count": 0,
  "notes": null
}
```

| 字段 | 规则 |
| --- | --- |
| `timeline_version_id` | 本轮批注所针对的成片版本。若时间线在收集期间被替换，新编辑进入冲突队列，不自动改写已有批注时间码。 |
| `status` | `collecting \| analyzing \| planned \| awaiting_confirm \| executing \| completed \| abandoned` |
| `change_plan_version_id` | 分析完成后指向不可变 ChangePlan 版本；拒绝后可再生成新版本，不改旧版本。 |

同一 `timeline_version_id` 上同时只允许一个 `collecting` 或 `executing` 的 Round。完成后可开下一轮。

## 2. ReviewAnnotation

```json
{
  "artifact_type": "review_annotation",
  "annotation_id": "ann_01K...",
  "round_id": "rr_01K...",
  "t_start": {"num": 125, "den": 25},
  "t_end": null,
  "frame": 125,
  "shot_id": "shot_023",
  "clip_id": "clip_023",
  "clip_version_id": "ver_clip_023_v4",
  "comment": "她太害怕了，改成怀疑但保持镇定，衣服、背景、台词不要动。",
  "category": "performance",
  "must_keep": ["character_identity", "wardrobe", "background", "dialogue"],
  "forbidden": ["crying", "panic", "stepping_back"],
  "priority": "must",
  "snapshot_asset_version_id": "ver_frame_...",
  "status": "pending_analysis",
  "merged_into_annotation_id": null,
  "created_at": "2026-09-05T12:07:00Z"
}
```

| 字段 | 说明 |
| --- | --- |
| `t_start` / `t_end` | 有理数时间码，相对当前 TimelineVersion。点批注只填 `t_start`。 |
| `frame` | Sequence 帧号，与 `t_start` 同时存，避免 UI 换算分歧。 |
| `category` | `performance \| action \| camera \| character \| wardrobe \| scene \| dialogue \| sound \| subtitle \| continuity \| pacing \| other` |
| `must_keep` | 本次修改必须保持的内容。程序复制到 ChangeItem，模型不得丢弃。 |
| `forbidden` | 用户明确禁止出现的结果，进入硬约束，不进综合分。 |
| `priority` | `must \| should \| observe` |
| `status` | `pending_analysis \| planned \| executing \| modified \| accepted \| rejected \| merged` |
| `snapshot_asset_version_id` | 批注瞬间的帧或局部预览，作为证据，不作为新主画面。 |

自然语言 `comment` 是用户权威意见；`category` / `must_keep` 可由 UI 预填或分析阶段补全，但补全必须可被用户在 ChangePlan 里看到和改。

## 3. ChangePlan

```json
{
  "artifact_type": "change_plan",
  "plan_id": "cp_01K...",
  "round_id": "rr_01K...",
  "timeline_version_id": "ver_tl_01K...",
  "schema_version": "0.1.0",
  "summary": {
    "annotation_count": 12,
    "merged_count": 1,
    "regenerate_video": 4,
    "regenerate_audio": 2,
    "edit_subtitle": 3,
    "timeline_adjust": 2,
    "needs_human": 0,
    "affected_shot_count": 6,
    "total_shot_count": 47
  },
  "cost": {
    "currency": "USD",
    "reserved": "4.80",
    "low": "3.20",
    "high": "6.10"
  },
  "conflicts": [],
  "items": [],
  "status": "awaiting_confirm"
}
```

## 4. ChangeItem

```json
{
  "item_id": "ci_01K...",
  "annotation_ids": ["ann_08", "ann_11"],
  "action": "regenerate_video",
  "target": {
    "shot_id": "shot_023",
    "clip_id": "clip_023",
    "clip_version_id": "ver_clip_023_v4"
  },
  "intent_patch": {
    "need_to_convey": "她已察觉对方说谎，但暂时不揭穿。",
    "must_keep": ["character_identity", "wardrobe_v2", "scene_v1", "dialogue"],
    "forbidden": ["crying", "overt_panic", "confrontation"],
    "allowed": ["micro_eye_shift", "natural_breath"]
  },
  "invalidation": "generate",
  "estimated_cost": {"currency": "USD", "low": "0.80", "high": "1.40"},
  "capability_risks": [],
  "status": "pending"
}
```

| `action`（Creator Beta 白名单） | 默认 `invalidation` | 说明 |
| --- | --- | --- |
| `regenerate_video` | `generate` | 新 GenerationAttempt → 新 ClipVersion |
| `regenerate_audio` | `generate` | 新 TTS Attempt；可能使字幕时间 stale |
| `edit_subtitle` | `export` | 改字幕资产，不重跑视频 |
| `timeline_adjust` | `check` | 只改时间线命令；若改变边界则升为 `compile`/`generate` |
| `no_op_duplicate` | `check` | 已合并到其他 item |
| `needs_human` | `check` | 模型或产品能力不足，列出可选替代，不扣生成费 |

`invalidation` 只允许：`check`（重新检查） / `compile`（重新编译提示词或时间线） / `generate`（付费重生成） / `export`（重导）。**检查范围和付费重生成范围必须分开存储**，不得用一次 `generate` 覆盖只需要 `check` 的镜头。

## 5. 意图验收单（挂在镜头，不另做产品面）

普通模式不单独做一个“验收单页面”。字段是 ShotIntent 的短约束，审片 ChangeItem 通过 `intent_patch` 更新：

| 字段 | 例子 |
| --- | --- |
| `need_to_convey` | 她已察觉对方说谎，但暂时不揭穿。 |
| `must_keep` | 角色身份、黑色风衣、台词、站位。 |
| `forbidden` | 不能哭、不能明显惊恐、不能当场揭穿。 |
| `allowed` | 小幅眼神变化、自然呼吸、背景轻微运动。 |
| `references` | 角色 v4、服装 v2、场景 v1、当前分镜。 |
| `acceptance` | 观众看出怀疑，但对方没有察觉。 |

结果判定用三类，不用单一综合分：`hard_fail` / `soft_deviation` / `unconfirmed`。用户写了“不能哭”却出现哭泣 → `hard_fail`，即使其他项很好。

## 6. 状态机

```text
ReviewRound.collecting
  --用户继续播放/加批注--> collecting
  --审核完成--> analyzing
  --分析成功--> awaiting_confirm   (ChangePlan DRAFT)
  --分析失败--> collecting         (保留批注，展示失败原因)
  --用户确认计划--> executing
  --用户拒绝计划--> collecting     (可改批注后再次审核完成)
  --全部 ChangeItem 终态--> completed
  --用户放弃本轮--> abandoned
```

ChangeItem 执行复用任务 Attempt，不自创一套远程状态。任一 item 进入 `REMOTE_UNKNOWN` 时，Round 保持 `executing`，禁止自动重提，进入对账。

## 7. 权限与审计

- 批注创建者、ChangePlan 确认人、各 GenerationAttempt 提交人分别记入 Envelope。
- 单用户模式允许同一人确认自己的计划，UI 显示“自审”。
- Agent 不得把 ChangePlan.status 直接写成 `confirmed` 或 `executing`。
- 日志不写完整未授权原文、不写帧快照二进制、不写密钥。
