# ProWorkspace 布局与选版核验

`apps/studio-web/e2e/pro-layout-audit.mjs` 核验真实工作台的页签与单镜版本区，不使用旧哈希页面或 `.v2-*` 演示壳。根命令 `pnpm audit:pro-layout` 与独立普通用户 Ubuntu CI job 已配置；配置存在不代表远端已通过或全产品已验收，运行结果以该次 `report.json` 为准。

## 运行

需要仓库依赖、Node 24 和可运行沙箱的 Chromium/Chrome。默认在 Node 进程内启动 Vite 中间件及 HTTP listener（127.0.0.1 实际随机端口），结束或失败都会关闭浏览器、上下文和服务器，不派生 pnpm 开发服务。

```sh
pnpm audit:pro-layout
```

也可复用已有本地 Vite，显式选择浏览器和忽略目录：

```sh
node apps/studio-web/e2e/pro-layout-audit.mjs \
  --url http://127.0.0.1:5173/ \
  --browser /usr/bin/chromium \
  --out .aijian-dev/pro-layout-audit
```

对应环境变量是 `AIVORA_AUDIT_URL`、`AIVORA_CHROMIUM`、`AIVORA_AUDIT_OUT`；命令行优先。浏览器依次尝试显式路径、系统 Chromium、系统 Google Chrome、Playwright 安装的 Chromium。始终 `chromiumSandbox: true`，不自动关闭沙箱。`--url` 只接受本地 HTTP 服务；不支持直接针对生产构建运行，因为合成工程通过 Vite 源模块载入。

默认输出到系统临时目录下 `aivora-pro-layout-audit`。自定义输出只允许系统临时目录或本仓库 `.aijian-dev` 下，避免改动产品文件。输出包括 `report.json` 与逐组合截图；`vite-cache` 是临时依赖缓存，不必作为 CI 证据上传。退出码：0 全部通过，1 导航/几何/选版回归，2 参数、浏览器或服务启动等环境错误。不会递归删除输出目录；输出路径解析后仍必须属于允许的临时/忽略目录。

## 准确范围

| 组合                                                | 实际页面/断言                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1280×800、1920×1080 × 16:9、9:16，每组合 3 版本工程 | 剧本 textarea 与 script stage、分镜 stage 与 6 卡、剪辑 stage 与预览/6 片段     |
| 同上，每组合 1/2/3 版本工程                         | 单镜真实入口、版本数量、版本区用满可用宽、数量标题不纵排、标签/按钮不越卡或视口 |

共 12 个独立浏览器上下文、24 个页面/状态截图。导航先断言真实 stage/DOM 到达，再检查控件中心遮挡、无滚动退路的裁切、文档溢出及候选卡内容边界。可滚动面板中的屏外控件会单独记录，不作为不可达裁切；不会忽略其他几何失败。

2/3 版实际点击选版按钮，同时等待 UI 选中状态和浏览器序列化存档一致，再通过库函数回读完整 takes，核对原有版本元数据及其他镜头选择未改变。等待谓词同步读取存档，避免旧 Playwright 将 async 谓词的 Promise 当作立即成功。1 版没有替换按钮，只点击当前卡并核实选中保持。

合成工程与 IPC 替身由 `pro-layout-fixture.mjs` 提供，媒体使用仓库已有 `apps/desktop/fixtures/shot-a.mp4`，报告记录 SHA256，不依赖宿主 FFmpeg 或调用生成服务。替身的补做/导出派发会被视为异常。浏览器阻断外部 HTTP 与 `/api`；出现此类尝试仍会令该次核验失败，而不是放行网络以取得通过。

## 不涵盖

不代表所有页面、角色/声音/字幕/设置、所有建议或错误状态、真实会员、真实 Electron、Windows 安装包、文件恢复或完整导出链路验收。也不代替原有宿主、业务、类型与其他 CI 检查。后续扩范围必须先增加明确的页面到达与交互断言，不得用旧页面截图或空壳元素推定功能成立。

## CI 与诊断

独立 `pro-layout (ubuntu)` job 使用普通 runner 的预装 Google Chrome、Node 24.15.0 和 frozen pnpm 依赖，不在 Debian root 容器中启动浏览器，不更改现有 quality 矩阵或覆盖率门槛，不创建共享缓存。仅上传明确的 `report.json` 和两种窗口组合的 PNG，允许隐藏路径、保留 7 天，不上传 `vite-cache` 或整个工作区。

GitHub 环境中失败最多发出 8 条 `::error` 注释，只包含固定诊断码、已知组合/页面、白名单问题种类及数值；原始错误、控件文字和完整报告留在 artifact，不拼入公开注释。参数/启动失败发出安全环境码。

本轮本机正向浏览器复验因 UID 映射导致 Chromium 无可用沙箱而退出 2；静态、组件及 negative 检查不能冒充本机默认或 `--url` 的 24 状态通过。总控已将正向验收移到上述普通用户 Ubuntu CI；后续必须读取真实运行结果，不能把本机早期临时脚本或配置接入当作正式门已通过。
