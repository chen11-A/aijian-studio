# B08 音轨试听：同输入有界等待不随粗剪元数据重启

真实 Pro 受控 `mix-preview-retry` 探针在旧 consumer 上复现：第一次 8 次 BUSY 结束后，粗剪的 canonical adopt 新引用重新启动同一输入的 8 次，总计 16；assembly1/cancel0/forbidden0。新的试听输入 key 排除保存/粗剪引用、波形 peaks/分析缓存和许可元数据，按实际混音/字幕输入及明确 retry、启用状态隔离一次预算。原 8 次上限、250ms 间隔、主进程授权、实际源 SHA 和保存 lease 均不放宽。

每次保存重新取得 latest live 对象，并用该对象的精确引用 guard；不会为保持 key 相同而重放旧 film。保存后读 canonical、检查实际项目 ID 和消费投影，再算 fresh 完整 raw hash 请求 main。同输入元数据新引用不会借旧快照存盘；新 gain/trim/选版/path/对白/字幕、或明确 retry 仍重新核验。view 也绑定其输入 key/epoch/启用状态，不把旧工程或旧输入结果短暂借给新输入。

当前身份对应的波形 source SHA 只作为重新检查的 hint，不能授权媒体、代替 main 逐源重核或当缓存证明。首次进入编辑先等本次真实波形处理及保存，再 primed 准入试听，避免首次测量自己再开启一轮 8。primed 只归当前工程/本次 edit 访问/source identity；离开再进、换工程、换源再换回都不能借旧 prime。同 identity 手动刷新波形不关闭已准入试听，实际 source SHA 新 hint 才重新 main 检查；原 wave.settled 仍用于 assembly 首次准入。原双 hold 回归加强为 wave 完成→preview 完成→assembly 准入，不把 prime 当来源授权。

## 实际验证

- 同一前端原探针：before 精确 16 对 8 失败，after **preview8/assembly1/cancel0/forbidden0** 通过，未扩原 oracle。日志 `/tmp/assembly-preview-key-before.log`、`/tmp/assembly-preview-key-after.log`。
- 正常 CI 可执行的 Pro 回归：终态 BUSY8 后 canonical adopt 和成功 assembly refs 仍保持 8；用户明确点击重试才第 9 次。无 legacy assembly、provider 或重复合成。
- 最终 primed 增量四文件 **27 项通过**，含 latest-ref 延迟保存、fresh raw、不同 canonical 拒绝、真实消费字段/测量 SHA/显式 retry、纯 peaks/许可/粗剪引用不重开，以及 visit/project/source prime 隔离。日志 `/tmp/assembly-preview-key-primed-tests.log`。较早三文件 23 项、六文件 35 项是重叠阶段证据，不累加。
- 同源波形手动刷新也已受控复现：内部 settled=false→true 的旧 gate 会再开 8 次，总 16；新 prime 后保持 **8/assembly1/cancel0**。日志 `/tmp/assembly-preview-key-wave-before.log`、`/tmp/assembly-preview-key-wave-after.log`。另有实际 Pro 不同 source SHA hint→fresh main 的正向。
- primed 增量前固定源的完整原 `ProWorkspace.test.tsx` **141 项通过**（不是最终 primed 源全量证明），日志 `/tmp/assembly-preview-key-original-host-final.log`。首例保留原生成、真实新 ABI 粗剪/存盘、QC 取消/失败/重查/成功链。现在等待本次请求项目的实际粗剪保存，再用明确 READY hold 证明检查中同名 disabled 按钮点击 0publish，释放且 enabled 后才发布；没有改 QC 产品 guard、添加 sleep 或放宽 timeout。
- 最终 primed 源复跑原前端 8 次探针及首生成/保存/QC单例，正式 `pnpm typecheck:ts`、web build、目标 ESLint/Prettier/diff 检查均退出 0（对应 `/tmp/assembly-preview-key-*-final.log`）。没有 API、contracts、依赖、锁或全局 `prepareHistoryInput` 变更，没有真实会员调用。

单位夹具按真实打开工程的 `upgradeFilm` 结果设置 canonical；原 raw sample 部分台词会在加载时补结构化 lines，不将这种夹具不一致当理由放松消费投影检查。实际时钟/partial/原文件保护仍沿已交 B08 主链，本片不新增媒体能力或真实时间对齐承诺。
