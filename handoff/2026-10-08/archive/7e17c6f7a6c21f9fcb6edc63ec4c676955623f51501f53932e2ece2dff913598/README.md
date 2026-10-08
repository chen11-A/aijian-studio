# QA03 SOURCE 项目名称：Web typecheck/build 门

状态：`FROZEN_NOT_APPROVED_NOT_RUN`。本门在当前 c19 的 `StoryPages.tsx` SHA256 `34D272A7ED104E2A983BAB774212C17F6CF7F9913198212B7052E7487B67DA60` 上执行真正的 Web TypeScript 检查和 Vite 构建。它独立于已通过的五案 mock 组件门；不包含 sidecar、新进程持久化、Electron 或 provider 验收。

MGR02 审签输入为 `PACKET.json` SHA、runner SHA、MGR04 StoryPages 冻结快照和保护同步回执 SHA、component-02 收据 SHA、c19 HEAD/status、113 项 source 与 82 项 dist 的基线指纹，以及 Node/TypeScript/Vite/fingerprint helper SHA。模板 `RUN-APPROVAL.template.json` 为 `NOT_APPROVED`；输出目录 `web-01` 尚未创建。只有独立 `APPROVED_SINGLE_RUN` 封套可触发一次运行。

runner 前检所有输入和关联 c19 进程为零，保存 before 指纹；运行 `node tsc -b --pretty false`，再保存 after-typecheck 指纹。类型检查的 source 与 dist 均须与 before 同字节。随后运行 `node vite build`；此步骤会写 c19 的 `apps/studio-web/dist`，因此保存完整 after-build 指纹、dist 新增/删除/变更路径和前后 SHA；只要求非 dist 的 Git status/source 字节不漂移。两步均记录子进程 PID、命令参数、退出码、超时/清理和原始 stdout/stderr 哈希，600 秒有界。任一 RED 停止后续执行并保留收据和已产生的 dist 状态；不会自动重试或回滚。

最低依赖闭包：`apps/studio-web` 现有 `tsconfig.app.json`、`tsconfig.node.json`、`vite.config.ts`、Node/Vite/TypeScript 安装与 c19 源；HEAD/status/113 项源指纹固定整个有改动源集合，四个 CAS 关键文件另逐项校验。`pnpm` 脚本中的 `build` 为同一 `tsc -b && vite build` 顺序，本 runner 分开执行以保存每步原始证据。`tsc -b` 可能更新忽略的 `node_modules/.tmp` 增量缓存；Vite build 预期写 dist。批准前未执行。
