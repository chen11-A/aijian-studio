# 本批验收证据

所有本批运行代码固定为 `de2cb0629e4934ae9bbfd09e2da6f77a772cb97c`。本目录只存交接记录，不参与运行。最终结果以每份回执实际exit与[验收与交接](../验收与交接.md)为准；pending不是通过。

- native.json：原完整原生门和前置检查。
- web.json：原完整界面门与Node合约。
- production.json、production-summary.json：原collector、生产builder与隔离装载；不冒Electron运行。
- compiled-noop.json、compiled-noop-result.json：真正编译后工厂的本地可读视频复用流程；账户/API/provider/写入0，只限Linux CJS。
- windows-installer.json：同一源码的真实Windows非管理员安装、同候选重装、读回和卸载保留检查；不是不同版本升级或真实用户整片验收，发布步骤skipped。
- browser-targeted-ci.json：原16浏览器任务/484组合及Windows定向；不代替双平台完整quality。
- worktrees.json：交接时目录和分支位置。

完整API与CI回执会在实际结束后补齐。临时原日志分别保留 `/tmp/aivora-handoff-*` 和 `/tmp/aivora-status-42415135411*`，失败或暂停记录没有覆盖。

## 复跑入口

先检出验收代码提交，按仓库CI准备Node24、pnpm11、uv和锁定媒体工具，安装原锁定依赖；独立Windows构建工具沿 `npm ci --prefix packaging/windows/build-toolchain --ignore-scripts`。保持原测试/覆盖/超时：

```sh
pnpm contracts:check
pnpm typecheck
pnpm lint
pnpm --filter @aijian/desktop test
pnpm --filter @aijian/studio-web test
pnpm test:py
node --test scripts/build-runtime.test.mjs
```

生产collector和builder用原 `packaging/windows/freeze-sidecar.py` 的三个stage函数及 `scripts/build-desktop-runtime.mjs`，保留其JSON收据。

编译后探针 `compiled-noop-probe.cjs.txt` 是独立验证脚本文本，不是应用源码；复制到临时.cjs后传实际app目录、collector资源目录、原Linux工具pin JSON和工具目录。探针要求app名以 `-production-app` 结尾，并读取同prefix的 `-production-receipt.json`，源码必须为de2cb06。它不授权供应商调用、不创建发布包。

本次代码分支与文档归档分支分开。文档记录提交可跳过重复代码CI，运行代码的验收只看de2cb06的原完整CI，不能用文档提交跳过源码验证。未验收续接内容见 `../checkpoints/README.md`，未经新指示不恢复开发。
