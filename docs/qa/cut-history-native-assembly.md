# 剪掉后的派生粗剪引用与撤销

基线 `29140d5c8f1d570c9d6d81e63fed37300a22ebdc`。在新 5-3 四态浏览器 QA 的实际 Pro 短宿主中发现：剪辑页六个有原版视频/音轨的镜头，Delete 后实际本机 assembly ABI 完成五镜重合成，Ctrl+Z 仍停在五镜。当前焦点 BODY、没有输入或菜单；真实队列/operation idle 也不改变结果。

原因是 `diffUserShotEdit` 的非 shots 内容检查把自动更新的 `assemblyPath/assemblyUrl` 视作另一创作变更，返回 `OTHER_COLLECTION_CHANGED`，上层历史转为 `STRUCTURAL_HISTORY_UNSUPPORTED`。初次受控 trace：`/tmp/ui-interactions-undo-proof-trace.log`；新增纯 before：`/tmp/ui-cut-native-assembly-before.log`；同一最终实际 Pro 回归在原实现下仍真实失败：`/tmp/ui-cut-assembly-real-host-before.log`，5 != 6。

最小修改只在用户镜头结构差异的额外集合检查中排除这两个派生引用；不泛滤 savedAt/directory、其它创作字段或其它集合。事务/inverse 仍只替换原 shots，依赖/after-state/工程范围守卫保留；不回放旧全工程，不删媒体，不借粗剪文件或缓存作为权限。

实际 Pro 永久回归使用原队列及现正常门默认合成 native ABI：Delete 和 Backspace 各一次六→五→撤销六，总计五个精确 assembly 请求。恢复六镜后保留当前五镜派生 path，真实 `assemblyClockState` 必须立即为 stale、`assemblyClock` 必须为 undefined；持有第三/第五 native 请求时不能借旧五镜 clock。随后受控完成，要求按六镜真实顺序及当前 canonical hash 重合成，并得到新的已核 clock/path。全部原 shots/takes/stills/selected take/六条音轨保留，0 provider/0 legacy/0 cancel；原删除留下的两次孤立声音只用受控 SOURCE_CHANGED 拒绝，绝不当付费功能放行。

纯回归还要求其它创作字段/音轨或人物集合变化、不同工程仍拒绝；已成立的结构 inverse 保留后来无关画风编辑。最终目标联合为原结构/page-history/history 宿主 + 新永久 Pro：5 文件 **28 项通过**，日志 `/tmp/ui-cut-assembly-after-joint-final.log`。正式 web build（含 tsc-b）及目标静态/格式见 `/tmp/ui-cut-assembly-build.log`、`/tmp/ui-cut-assembly-eslint.log`、`/tmp/ui-cut-assembly-format-check.log`。

这是 UI/队列与合成 ABI 的真实消费者回归，不代表 FFmpeg 文件已在本机重新生成、播放或完整视听。新 5-3 四态 QA 仍是独立 WIP，未混入该小修提交，也未以此宣称正常 Chrome 新16通过。
