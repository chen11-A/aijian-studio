# 交付与旧操作审计：首次无合成任务的保存就绪

首次正常 Chrome：source 623 / run 42364827939 / job 128380574958。公开最多八条都为首个 1280×800、16:9 的八个 state，reached=0、cases228；未据此推断其余 24 个结果。该行调用共同 boot 的 `waitAssemblyIdle`，尚未进入具体交互。原 388 正向与本新增 32 的失败分开保留。

公开 `kinds=assertion` 是 shared runner 在无几何 issue 时的通用 fallback，不能据此断言一定是同步 generation assert。实际 Pro/script 受控宿主确认：当前 scope 匹配、真实 400ms autosave 有本工程 generation 且已 fired、一次 write 完成、native calls 为零。helper marker 将没有 operation 记为 null，但最终 predicate 读取最后 operation 时得到 undefined；两者不相等，故即使真实保存已就绪仍等待不完。

唯一 helper 改动是 predicate 同样以 `?? null` 表示无 operation。scope、stage、generation、所有 scoped/unbound timer、pending write/native、状态栏保存、operation 精确匹配均保留，不调 timer、不主动 flush、不删等待。永久 actual-Pro Vitest `pro-evidence-boot.test.mjs` 从真实 Pro 渲染及默认 fixture 出发，断言上述完整前提、完成 write 和零 native/生成；它是真 Vitest 用例，不是误收集的 node:test 文件。Node 契约仍使用 `.contract.mjs`。

原 timer 契约新增无 operation 正向，再实际准入原 assembly；保持 scheduled timer、pending write、歧义 scope 均不能通过，并增加等候期间实际出现另一个 operation 必须拒绝旧 marker 的负例。原其他 110 项契约不删，原 workflow、状态矩阵、阈值、0 付费派发和沙箱策略均不改。helper 本就列在固定源码指纹中。

受控 before：`/tmp/evidence-boot-host-before.log` 实际 Pro 用例在最终 predicate 等待失败；修后 `/tmp/evidence-boot-host-after.log` 1/1 通过，639ms 测试体。首诊断 `/tmp/evidence-boot-controlled-before.log` 保留闭合 SAFE_BOOT 数据，临时源已移除。正常 Chrome 新 32 仍必须重跑；这不替代页面几何、实际解码、文件复制或人耳试听，也未宣称整个首次失败矩阵因果已获云端后证。
