# QA03 DemoApp 修复版组件复验与构建门

2026-09-24，c19 HEAD 211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2。MGR04 同步单文件后 DemoApp.tsx SHA256 8ED2682975EA9980561DF0EC55BF51CB7E1FF49CC0B98A6C6431B73C9BE559D8。本窗口 c19 status 始终 57，产品文件未编辑。

1. 原外置 5 例，测试 SHA256 4201CA10F93133A7E02ACC1F44E117EB43270B58DB8C6837EE88026FD8C34675：4 passed、1 failed、exit1。green-01 目录保留 stdout/stderr/result 与前后 status。失败是测试在无项目夹具下固定要求“暂无新通知”；实际生产文案提示“当前未选择真实项目。请先创建或选择项目”。MGR02 核对后认定原断言过窄，产品此状态无演示承诺。
2. 保留原 4 项断言，在外置修订测试增加无项目与有项目但空任务队列两个场景。修订测试 SHA256 932FBEEA05C62A0ABCB10E4075B4F1889BB5488837D6B9B15FEB294F17A7F3D1，revised-01/run-01 6 passed、exit0；stdout SHA256 F1CB3BBE1A1C1E7B43BCFF1216CE4FE9AA22557E995F76A56A4888DB6FB8C35D，stderr 空。此为 jsdom 组件合同，不是 Electron 原生验收。
3. 按经理后续门执行 pnpm --filter @aijian/studio-web typecheck：exit1。真实错误 apps/studio-web/src/domain/provider-settings-model.ts:13 TS2741，生成 ProviderKind 已含 SUB2API，但 providerPresets 的必填 Record 缺此键。build-01/web-typecheck.stdout.txt SHA256 BED1692CA5F87268DB710FCB2AF09B35D1FD0114B562FE306DA162A579AACB35；stderr SHA256 5E419D5756C7F39390F8B5CAC48831A2CF6A3983F8BD0916F14FE67EE9087170。build-01/before.json 与 after-web-typecheck.json 比较：60 源和 75 dist 的路径、字节、SHA 全相同，HEAD/status 相同。未继续 desktop typecheck 或 web/desktop build。

真实错误已交 MGR02/MGR01/MGR04。后续须统一作者修订、独立快照与受控同步后，再顺序复验 typecheck/build。本次未运行 Electron、provider 或安装验收，c19 测试位释放。
