# 当前场导演字段卡与固定 @ 参考整合

整合基线 `3bfb4f5`，合入导演结构卡 `87931f3`；不回改任何原冻结树。正常导演及手动重试均把该次捕获的参考传给 `publishDirectorProposal`，同时保存到固定 `StoryDraft` 和独立 `RoleCard`，不在回复后读取新的聊天稿或参考对象补授权。

未应用确认继续检查原 `draft.references`，沿用原完整结构审核、原事务、保存及锁。应用改变首镜后，卡片仍用实际 `postSelection` 展示，但它不成为新的 forward 参考授权；专属撤销只使用原 origin／story token／inverse after-state 锁，不重新校验已被自身应用改变的旧参考指纹。编剧、multi-scene 和 needsCast 的原 legacy 路径不变，字段模式不会在应用后悄悄请求人物提取。

新增真实 Pro 宿主以合成文本 ABI 实际进入导演及表演／动作补充链：确认前镜头不改、不保存新结构；确认后选中新的第一镜；专属撤销恢复原镜序，并保另一场原媒体／take／选版、后来首帧及无关标题。另两项在参考人物改名／删除后调用旧固定确认，验证零结构写、零额外文本请求、零媒体生成。原 24 项引用宿主保留，当前合计 27 项；没有把初始 seed 与已规范化 canonical 全对象混比。

定向日志：`/tmp/director-refs-joint-final.log` 为 13 文件 251 项（引用、导演独立卡、美术、动作／表演／画面字段、整场声音、notice 和架构门）；`/tmp/director-refs-old-writer-final.log` 为旧 writer 必要兼容。正式类型／构建、contracts、目标 ESLint／Prettier／diff 以 `/tmp/director-refs-` 前缀保留，未重复完整覆盖门。

本片仍是合成 ABI 的真实宿主验证，不代表正常 Chrome、会员调用、媒体播放或 Electron 验收。下一独立浏览器片增加 4 态 × 两窗口 × 两画幅，原 340 态及几何规则保留；这里不提前把待跑浏览器结果写成通过。
