# 旧流水线首次绑定后端工程

真实顺序：workspace `execute` 先 `ensureBillingProject`、取得保存 lease、原 beforeRun history，再调用 controller。全新流水线在 ID 补建后才建立指纹；旧持久流水线若缺 ID，则补建改变业务指纹，原 controller 会以 `PIPELINE_INPUT_CHANGED` 拒绝。`/tmp/pipeline-billing-bootstrap-before.log` 实际单例1失败/14未选记录此边界。

本片只允许本轮可信 ensureBillingProject 的精确 ID-only 变化：调用前捕获完整原稿，原有效 pipeline 属于同作品、原外层指纹必须匹配原实际业务内容；取得 lease 后，当前完整raw除了补建 ID 必须完全等于捕获稿。本轮返回 ID 必须等于当前 ID。两个异步 digest 后仍检查同 live 引用/完整raw/owner，保存后再次核对，再同步 apply。只更新外层 `productionInputFingerprint`；原 pipeline、inputVersion、每步/target事实全部保留。没有重置计划、重跑文字或冒人工 review 通过，不全局排除 backendProjectId。

已有ID换绑、原指纹陈旧、本轮创作/进度变化、digest等待期间新编辑均不迁移。旧派发/取消/lease/owner门保留；保存失败不先apply。read-only recover 不建立绑定。

## 验证

- `/tmp/pipeline-billing-bootstrap-joint-final.log`：原 workspace/controller、actual Pro 联合3文件59项通过 / 6.69秒。
- actual Pro 包含已有绑定和缺ID两种持久pipeline：实际首媒体确认→展开人工审片并记下结论→独立继续→原assembly一次，0文本/图/视频新增请求，全部shots/takes/原媒体保留。桥的 local receipt 是 controlled ABI，不能称本机视频已解码或真实provider通过。
- host真实before→after正例；旧输入陈旧/补建中创作变化/进度变化/已有ID换绑负例；受控digest await期间新标题保留、0save/0dispatch；原projectChanged/取消目标全部保留。
- `/tmp/pipeline-billing-bootstrap-types-final.log`、`...-eslint.log`、`...-prettier.log`：正式网页类型、目标静态/格式与diff0。首类型发现测试误写不存在的step.attempt，已改实际target.attempt，首失败日志保留。

只完成这一窄迁移，不扩大未完成的pending pipeline/portrait/cache/continuity生成能力，不替代原完整web或normal Chrome。
