# 导出交付证据：界面接线核对

核对基线：`96d5bfc7e20aca43583bb221f3ebaf69f8e5241c`。本页为只读方案，尚未新增交付证据组件或宣称能力已接通；稳定 main 合同到位后另做真实宿主回归。

## 真实消费者

- `apps/studio-web/src/aivora/pro/ProWorkspace.tsx:4752` 的 `publishCheckedExport` 仅由审核后的用户动作调用。发布前后核 `qcContextCurrent(check.key)`；原取消、双画幅任一 block 禁发布、busy 和主进程 owner 仍是边界。
- 同文件 `4808` 把 main 返回的首个实际 output path 记录为 `film.exportPath`、`exportFile`；工程记录保存失败仍明确文件已发布但工程记录没保存。`PARTIAL` 保留已落文件，不能等同全部成功。
- 同文件 `7516` 的 `ExportCheck` 展示准备期技术 QC 与人工未验证项；`7545` 结果行目前直接显示路径“导出好了”。`7554` 后目录/播放按钮仍以该内部路径调用原桌面桥。播放请求、timeupdate 和 technical QC 都不证明完整观看或试听。
- `packages/contracts/src/film-export-qc.ts` 当前发布 DTO 只有 PUBLISHED/PARTIAL outputs 或固定失败/取消；没有可交付 manifest。`apps/desktop/src/film-export-qc.ts:776` 返回实际落盘 outputs；异常有已落输出时返回 PARTIAL。不能由 renderer 自己拼一个清单冒充 main 证据。

## 最小下一片

新独立 pro 域结果卡和封闭投影 adapter 消费 main 的可选 `deliveryEvidence`（准确类型等稳定提交，不复制 WIP）：只有明确 WRITTEN 才显示 main 返回的清单文件名、SHA256 和 curated facts。预期清单包含相对文件名、最终字节 SHA、实际技术参数/unknown、选材描述、实际 settings/QC 摘要与未验证项；不渲染原路径、receipt、owner、原始 probe 或凭据。不从路径 basename、播放事件或缓存字段补造证据。

结果语义分开：缺字段的 legacy 明确“未提供交付清单”；清单写失败给固定说明，不报告清单成功；PARTIAL 只陈述 main 已落证据，保留原文件操作，不报整份完成。WRITTEN 的 SHA 用于文件核对，不作质量、视觉/听感、来源或后续费用授权。目录/播放仍沿原内部 path，不把路径当产品正文。

结果 state 绑定实际 project/单次 operation 与发布上下文；换作品、输入变更、旧回包或旧按钮回调不覆盖新结果。沿原明确发布确认，不自动再次发布、检查、生成或调用供应商；不把查看清单变成新 owner。不得因为拿到清单回放旧 film 快照。工程记录保存失败与真实文件落盘分别说明。

必要宿主回归：WRITTEN 的真实字段透传；legacy 缺证据；PARTIAL+已落清单；PARTIAL+清单失败；FAILED/CANCELLED 不伪成功；长文件名/SHA/全部未验证项可读；旧工程/旧 callback 零污染；发布期间仍仅一次原 RPC、原 block/取消/保存失败保护不变。正常 Chrome 新态后续独立追加，不挪用原 356 或风险/配置新增 32 的待验状态。

## 原编号边界

`docs/qa/5-3-界面走查.md` 原始编号仅 **5-3-01 至 5-3-15**。5-3-11/12 是安全框与全屏，5-3-13 是无视频占位，5-3-15 是引用范围；都不能用来证明成片已完整观看或试听。该文档保有旧基线历史文字，不在本片覆盖或刷新成“本轮全验收”。新增交付证据对应开发计划 **4B-B09、4B-U05/U06 与 6-1** 的实际文件/检查/交付边界，不伪造一个原 5-3 新编号。Windows 安装包、真实会员、完整播放试听、真实试片结果/父级输入和批量放行仍是独立未完成项。
