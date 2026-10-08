# Desktop delivery backlog

审计对象：`C:\Users\Administrator\Documents\sp\.cache\aivora-worktrees\only-ui-product-20260910`

审计范围：只读检查 `apps/desktop/src/main.ts`、`sidecar-process.ts`、`preload.ts`、sidecar protocol/API client、媒体预览域代码、根/桌面 package 配置及已有媒体播放 evidence。没有修改产品工作区，没有安装依赖、构建全套或执行 runner。

当前结论：开发版入口具备 Electron 主窗口、preload 隔离桥、loopback token handshake 和开发 sidecar 启动路径；它还不是可独立安装版。已有 `media-playback-electron` evidence 仅覆盖复制到隔离 profile 的固定 WebM fixture 的 Electron 解码、播放、seek/resume 和 hash 稳定性，不覆盖产品 timeline 到播放器的真实媒体读取链路。

## 最小缺口

### D1 — 为 packaged app 提供 sidecar runtime bootstrap（阻断独立运行）

- 现状：`apps/desktop/src/main.ts:59-78` 的 `developmentSidecarOptions()` 在 `app.isPackaged` 时明确抛出 `Packaged sidecar runtime is not available`；未打包时还硬编码仓库相对 `.venv`、仓库 cwd、源码 `PYTHONPATH`，并强制打开 `AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME=1`。
- 受影响文件：`apps/desktop/src/main.ts`、`apps/desktop/src/sidecar-process.ts`、`services/api/src/aijian_api/sidecar.py`；新增 release packaging/resource 配置。
- 输入：安装目录中的 sidecar 可执行入口/解释器、sidecar Python 模块及其依赖、版本/协议配置、用户数据目录。
- 输出：以 `127.0.0.1` 随机端口启动的 authenticated sidecar；stdout 首行仍符合 `sidecar-protocol.ts` handshake，API 数据写入 Electron `userData` 下的 workspace；生产模式不得默认 fake timeline runtime。
- 实现边界：增加 packaged/development 两套明确 resolver；不要把仓库 `.venv` 或 cwd 当作发布运行时。若采用冻结 Python/sidecar executable，应把其视为发布 artifact，并保留现有 token/origin/parent-pipe 约束。
- 验证：在一台没有源码 checkout、没有项目 `.venv` 的干净 Windows 用户目录安装后，启动应用，确认 sidecar handshake、`health:get`、创建/重新打开用户数据均成功；关闭窗口后确认 sidecar 退出。
- 新依赖：不需要新的 npm 运行库；需要发布 sidecar runtime/artifact（冻结 Python 或等价受控运行时，具体方案待总控批准）。

### D2 — 建立真正的桌面安装/打包产物（阻断独立安装）

- 现状：`apps/desktop/package.json` 只有 `tsc`、`electron .` 和 Vitest；根 package 只有开发构建脚本，没有 electron-builder/Forge 等打包配置、资源清单、Windows installer target、应用图标或 release artifact 校验。
- 受影响文件：根 `package.json`、`apps/desktop/package.json`、`apps/desktop/tsconfig.json`，新增且仅限桌面发布的 packaging config、icons/resources、构建/验收脚本。
- 输入：编译后的 `apps/desktop/dist`、`apps/studio-web/dist`、桌面主进程/preload、D1 sidecar runtime、必要媒体/配置资源、版本与签名参数。
- 输出：可在无 pnpm/Node/源码/仓库 `.venv` 的 Windows 机器上安装并启动的 versioned installer（以及可追溯的 hash/manifest）；安装、卸载和用户数据目录边界清晰。
- 实现边界：先选定一种打包器并固定其配置；不要把开发目录、测试 fixture、`.aijian-dev` 或 secrets 打进生产包。签名/更新服务不是本条的隐含完成条件，但应在 release manifest 中显式标为未配置或已配置。
- 验证：在干净 Windows VM/账户安装、启动、创建项目、重启恢复、卸载；核对安装包内容和 SHA-256，确认用户数据不随卸载误删（除非明确选择）。
- 新依赖：需要一个打包工具（electron-builder 或 Electron Forge 二选一）及其锁定配置；是否引入由总控决定。

### D3 — 把受验证的媒体读取接到产品 timeline 播放器（业务接入缺口）

- 现状：`apps/desktop/src/timeline-contract.ts` 只验证 `media_package` 的相对路径、hash、长度和 MIME；`apps/studio-web/src/domain/bounded-clip-preview.ts` 只接受调用方已经提供的 `ArrayBuffer`，并负责 Blob URL 生命周期。`rg` 未发现产品 UI 调用该读取域逻辑；`apps/studio-web/src/aivora/README.md:23` 也明确说明没有读取任意文件或媒体 bytes。现有 `scripts/e2e/electron-media-playback-smoke.mjs` 播放的是独立 fixture，不是 timeline 返回的 asset。
- 受影响文件：`services/api/src/aijian_api` 的媒体读取/路由与权限边界、`apps/desktop/src/api-client.ts`、`apps/desktop/src/main.ts`/`preload.ts`、`apps/studio-web/src/aivora/TimelineWorkbench.tsx` 及 `domain/bounded-clip-preview.ts`。
- 输入：已通过 timeline contract 的 `media_package` binding、选中 `asset_id`/frame range、sidecar session token；服务端 media package 根目录内的相对路径。
- 输出：只返回绑定 asset 的受限 bytes 或受控 media URL（含 MIME、长度、hash/版本校验结果），通过 main-only API 和最小 preload 方法交给 renderer；renderer 用现有 bounded Blob URL lifecycle 播放，并在切换/卸载时释放。
- 安全/业务边界：禁止 renderer 直接拿本地绝对路径、`file://` 或任意 path；服务端必须做 package containment、manifest/hash/byte limit 和 project/timeline 绑定检查。`DEVELOPMENT_FAKE` 与 `PUBLISHED_MEDIA` 必须显示为不同状态，不能把 fake 证据标成正式媒体。
- 验证：用真实 sidecar 生成的 timeline binding，走 preload 到 UI，验证选 clip、播放、seek、切换 clip、释放 URL、越权路径/hash/超限拒绝；再以 `PUBLISHED_MEDIA` fixture 重复一次。现有 fixture-only playback smoke 只能作为解码层子证据。
- 新依赖：不需要新的 npm 依赖；可能需要现有服务端媒体路由/读取代码的补齐。若采用 range streaming，应先确认 Electron/WebM 的实际需求再引入实现。

### D4 — 处理 sidecar 意外退出与可恢复状态（运行可靠性缺口）

- 现状：`apps/desktop/src/sidecar-process.ts:94-142` 暴露 `exited`，但 `main.ts` 只在退出时调用 `stop()`；未见对运行中 sidecar 崩溃、API 不可用、重启后的 session/token 替换或 renderer 可见状态的处理。当前窗口可能继续显示而 IPC 调用只得到 `Local API is not available`/网络错误。
- 受影响文件：`apps/desktop/src/sidecar-process.ts`、`apps/desktop/src/main.ts`、`apps/desktop/src/preload.ts`，以及 renderer 的 transport/错误状态组件。
- 输入：child `close/error`、health timeout、API 连接失败、用户重试/退出意图。
- 输出：单一受控状态机（starting/ready/degraded/stopping/stopped），一次性 bounded restart 或明确不可恢复错误；新 session 只能在 main 建立并替换，renderer 收到不含 token 的状态事件；退出流程仍等待正常关闭，不强杀正常 close。
- 验证：启动后杀掉 sidecar，确认 UI 显示 degraded、不会泄露 token、不会无限重启；验证一次恢复后旧请求/旧 session 被拒绝且新请求成功；再验证窗口正常关闭和 sidecar stop timeout 行为。
- 新依赖：不需要。

### D5 — 固定发布媒体工具链与用户数据/资源解析（发布运行时缺口）

- 现状：`services/api/src/aijian_api/sidecar.py:71-78` 从 `Path.cwd()/config/media-toolchain-lock.json` 查找 toolchain，fake timeline generator 还依赖锁定 ffmpeg 目录；这一解析假设成立于仓库开发 cwd，不成立于安装目录或快捷方式启动。生产发布同时需要明确媒体能力（WebM/其他格式、ffmpeg 许可与版本）和 workspace migration/upgrade 行为。
- 受影响文件：`services/api/src/aijian_api/sidecar.py`、`media_toolchain.py`、`fake_media_package.py`、`config/media-toolchain-lock.json`、`apps/desktop/src/main.ts`，以及新增 packaging resource manifest/migration code。
- 输入：安装包资源根、锁定 toolchain manifest、用户 `app.getPath("userData")` workspace、已有数据库/媒体包版本。
- 输出：从稳定的安装资源路径解析工具链；用户数据写入 userData 而非安装目录；升级时数据库/media manifest 可检测版本并给出明确迁移或阻断结果。
- 验证：从快捷方式、不同 cwd、无写权限安装目录和已有旧 userData 启动；生成/读取一个媒体包并核对 manifest/hash；确认升级不覆盖数据库、媒体资产或未知文件。
- 新依赖：不需要 npm 依赖；需要随安装包交付并许可审查的 ffmpeg/媒体 runtime artifact，或明确将其声明为外部前置条件。

## 推荐交付顺序

`D1 -> D2 -> D5 -> D4 -> D3`。D1/D2/D5 先让“独立安装后能启动并找到全部 runtime”成为可验证事实；D4 再建立失效边界；D3 最后把已存在的 contract/domain 能力接到真实产品 UI。每项都应分别记录源码、打包产物、安装运行和用户验收状态，不把 fixture playback 或静态 contract 证据升级为产品完成。

## 本轮未做

- 未修改产品工作区；其已有 dirty changes 未触碰。
- 未执行全量测试、Electron runner、安装构建或真实设备/用户目录验证。
- 未判断 provider 登录、AI 生成、渲染/混音/export 等业务创建能力；这些不属于本轮 desktop runtime backlog 的最小证据范围。
