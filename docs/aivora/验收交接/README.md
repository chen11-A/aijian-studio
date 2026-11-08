# 本批验收证据与续接

最终代码为 `babefa9af3e3fff0ad49cea93c70b3f1abeb80a4`，完整CI [42420151861](https://github.com/chen11-A/aijian-studio/actions/runs/42420151861) **20/20成功**。本目录为交接记录，不参与运行。总体范围见[验收与交接](../验收与交接.md)。

## 证据与来源

| 文件                                                                 | 含义                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ci.json、ci-windows-babefa9.json、ci-linux-babefa9.json              | 最终同源的双平台完整quality、原覆盖门、故障注入、证据、审计、构建及生成干净全部成功                     |
| browser-ci-babefa9.json                                              | 同源原16浏览器任务/484组合及两个Windows定向成功                                                         |
| api.json、api-summary.json、native.json、web.json                    | de2基线原全API5390通过/6原有跳过、原生2500、界面5629；保持实际来源                                      |
| web-50a6a3e.json、web-01db481.json、local-test-summaries.json        | 测试修复后的本地完整界面5630/5631及原覆盖；不借给其它提交拼数                                           |
| production.json、production-summary.json                             | de2实际collector、生产builder与隔离装载；首次缺独立工具依赖失败日志保留                                 |
| compiled-noop.json、compiled-noop-result.json                        | de2真正编译后工厂复用两份可读视频：6次ffprobe，账户/API/provider/项目写入0；只限Linux CJS               |
| windows-installer.json                                               | de2实际非管理员安装、同候选重装/读回/卸载保留成功；不是不同版本升级、真实整片验收或发布，tag步骤skipped |
| source-equivalence.json                                              | de2到最终babefa9只有三份web测试、四份QA差异；所有应用/依赖/构建/工作流一致                              |
| _-fix.json、ci-failure-_.json、ci-147aad4.json                       | 四处测试异步边界、原失败与上一源完整成功；原断言/超时保留，由最终完整CI关闭回归                         |
| checkpoint-integrity.json、worktrees.json、historical-worktrees.json | 检查点完整性、核心续接路径、历史定位快照；历史分支不是当前产品                                          |

各回执的source、exit、时间与范围优先。旧失败或pending字段记录当时状态；当前关闭结果只看最终ci.json及finalGateClosure。Linux原生覆盖是原窄auth/gateway范围，不能声称所有新媒体模块90%。本地CJS、Windows测试机安装或播放事件均不能代替真实会员调用、完整影片人工观看试听。

## 复跑与恢复

先fetch并检出最终代码，按仓库CI准备Node24、pnpm11、uv和原锁定媒体工具，安装原锁依赖。完整原门保持不变：

```sh
pnpm contracts:check
pnpm typecheck
pnpm lint
pnpm --filter @aijian/desktop test
pnpm --filter @aijian/studio-web test
pnpm test:py
```

生产资源/编译后探针的这次回执实际来自de2。严格复现时检出de2，沿原锁执行 `npm ci --prefix packaging/windows/build-toolchain --ignore-scripts`，运行原collector的三个stage函数与 `scripts/build-desktop-runtime.mjs`，保留JSON收据，再运行 `node --test scripts/build-runtime.test.mjs`。

`compiled-noop-probe.cjs.txt` 是Sol作者的独立验证文本，复制成临时.cjs，传实际app、collector资源、原Linux工具pin JSON和工具目录；app名须以 `-production-app` 结尾，并读取同prefix的production-receipt.json。其来源断言为de2，不可把旧收据改标新SHA。原脚本/锁与source-equivalence共同说明最终应用字节未变；最终babefa9本身已完成原完整CI。

续接先读本报告，再读[检查点恢复说明](../checkpoints/README.md)及manifest。检查点939b4c9/166dc89未合入、未启用；按bundle原ref导入新分支，禁止把目录或裸元数据当来源授权。当前无开发任务执行，只有用户新指示后恢复。

代码分支 `codex/aivora-audio-next-integration` 与记录分支 `codex/aivora-handoff-records` 分开。记录分支只比最终代码多docs/aivora文档和便携档案；纯记录提交的skip-ci避免重复运行，实际代码babefa9的完整CI没有跳过。原日志保留 `/tmp/aivora-handoff-*` 与 `/tmp/aivora-status-*`，长期回执已进入Git。
