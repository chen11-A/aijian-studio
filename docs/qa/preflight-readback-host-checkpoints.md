# 只读声音建议与拆镜宿主的完成检查点

本片基线 `c3830ef`，只改两个宿主测试与本文，不改产品、保存队列、main、阈值或 provider 路径。

## 实际失败与受控证据

- 云源码 `37f` 的 run `42334708295`：Linux `128288892009`、Windows `128288892020` 均出现声音建议宿主显示“暂时没有读到”、拆镜 unknown 按钮未出现；Linux 另一作品完整 raw 多出规范化的 `gender/ageBand`。公开信息不足以把每个 unknown 缺失都归为同一原因。
- root 固定 `c3830ef` 全量：427 文件 5165 项中唯一失败是拆镜 foreign recovery；完整 raw 已相等，但另一作品 write 从基线 0 变 1。原基线只看 header 和瞬时页脚，未等该作品打开后的真正初始化保存。
- 本地原两文件 42 项通过，不能据此抹掉云失败。受控真实生产 400ms autosave 在建议 RPC hash gate 中完成：普通写入恰一次，仅 `savedAt` 变化，hash 已变；旧 mock 的强断言抛错，被产品按传输错误处理。闭合证据 `/tmp/preflight-readback-controlled.json`、`/tmp/preflight-readback-controlled-before.log`。
- 真实拆镜 native `beforeCommit` gate 中，旧 1 秒按钮查询已经过期，但 apply 尚未返回、external 仍 pending、apply 只有一次。释放后真实备份损坏检查正确产生 unknown。证据 `/tmp/dialogue-native-inflight-controlled.json`、`/tmp/dialogue-inflight-and-baseline-controlled.log`。这证明不能把仍在途当成已有结果；不声称已读到云端未公开的 native 终态。

## 测试修正

普通声音建议入口先等进入剪辑后实际准入的保存回执完成，再取基线。native mock 对 stale raw 按真实 ABI 返回 `PROJECT_CHANGED/unchanged`；成功 `SUGGESTED` 仍严格断言 request hash 等于当次 canonical hash。新增实际 autosave race 回归：仅保存时间变化最多两次只读请求，第二次使用 fresh hash、完整四段可见，零添加与 provider；原创作/选版/作品/页面 stale 回归保留。

已确认 ACK 的拆镜测试等实际保存 lease 释放（包括真实 FS、备份与完整 delta 检查）后，再核原 unknown 入口；ACK 必须 `APPLIED`，明确失败不会被虚构成 unknown。新增受控在途回归，保留全部旧媒体、备份与零 provider 断言，没有延长原超时或添加 sleep。

foreign recovery 在打开另一作品前记录 write 游标，等该作品之后实际准入的写入 Promise 完成，并核所写完整内容对应当前稿，再捕完整 raw、当前引用与 write 数。此后 recovery 必须同时满足完整 raw 不变、当前引用不变、零新增 foreign write；没有过滤 traits、continuity 或保存时间来取得通过。

最终目标与正式类型/静态结果随冻结交付说明；本片不替代完整 TS、正常 Chrome、媒体播放或 Electron 验收。

冻结前结果：原两文件含新增受控例共 **44 项通过**（`/tmp/preflight-readback-host-final.log`）；正式 `pnpm --filter @aijian/studio-web typecheck` exit 0（`/tmp/preflight-readback-host-typecheck.log`），两文件 ESLint、三文件 Prettier、`git diff --check` 均通过。阶段 42、14 与受控子集不另行累加。
