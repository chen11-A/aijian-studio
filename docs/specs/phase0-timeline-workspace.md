# Phase 0 基础时间线工作台规格

状态：Implemented and accepted（UI01 / API01）；K01 仍在进行

依赖：[基础时间线与导出](phase0-timeline-export.md)、[媒体契约](phase0-media-contract.md)、
[项目与原文摄取](phase0-project-ingest.md)

## 目标

把已经完成的帧精确时间线内核接入本地产品工作流，使创作者能在 Web 与 Electron
工作台中读取当前剪辑版本、选择镜头、裁剪、前后移动和替换素材，并能明确看到版本、
总时长与输出画幅。该切片必须使用真实 API 和 SQLite 持久化，不能用页面内 Mock
冒充产品能力。

## 数据与版本边界

- 每个项目最多有一个 `timeline` Artifact；每次修改追加不可变版本。
- `TimelineVersionV1.revision` 与 Artifact head revision 完全一致，首版为 1。
- 创建请求只接受时间线 ID、Sequence timebase、素材 hash/帧数和 Clip 帧区间；不接受
  文件路径、URL、凭据或任意 Provider 参数。
- `GET /api/v1/projects/{project_id}/timeline` 返回最新版本并设置
  `ETag: "revision-N"`；尚未生成时间线时返回 `TIMELINE_NOT_FOUND`。
- 创建使用 `POST /api/v1/projects/{project_id}/timeline`，已有时间线时失败，不覆盖。
- 编辑分别使用 `/trim`、`/reorder`、`/replace` 命令；请求必须携带
  `expected_revision`。陈旧 revision、无效帧区间或无变化命令都原子失败。
- API 响应不泄露 SQLite 路径、媒体路径、Provider 凭据或内部异常文本。

## 工作台交互

- 左侧“剪辑台”在选中项目后可进入；未生成时间线时展示可行动空状态并引导先完成分镜
  和素材生成，不伪造 Clip。
- 有时间线时采用桌面剪辑布局：顶部版本/画幅/帧率/总时长摘要，中部预览监视器与镜头
  检查器，底部横向时间线。
- 时间线以 Clip 顺序和相对时长表达，不以颜色作为唯一状态信息；当前 Clip 同时有边框、
  文本和 `aria-selected`。
- 基础命令：向前/向后移动、修改源入点与持续帧数、选择替换素材。成功后使用服务器返回
  的新版本刷新；409 冲突时重新载入并明确提示，不做静默覆盖。
- 所有按钮、输入和 Clip 都可用键盘操作；加载、离线、空、错误、保存中状态均有可读反馈。
- 320、768、1024、1440 px 宽度不出现整页水平溢出；窄屏把检查器和时间线纵向排列。

## 验收

1. API 测试覆盖创建、读取、三种编辑、重启持久化、陈旧 revision、越界、重复创建、
   项目/时间线不存在和响应契约。
2. Web 组件测试覆盖加载、空状态、选择、裁剪、移动、替换、冲突恢复及键盘语义。
3. Desktop 客户端对新增响应执行严格运行时校验，Renderer 不直接持有 Sidecar token。
4. `openapi-drift`、Python/TypeScript 全量测试、构建和 lint 通过。
5. `web-e2e-skeleton` 在真实浏览器与 Electron 中完成创建项目、进入剪辑台、执行一次编辑，
   截图且控制台无错误。

以上验收均已通过；统一纵切证据见
[Phase 0 统一 Web/Electron 纵切验收记录](../quality/phase0-web-e2e-skeleton-acceptance.md)。

## 非目标

本切片不实现多轨道、转场、字幕、音量包络、调色、拖拽吸附、撤销栈、产品级编码器或
真实 Provider 生成。K01 将负责从 Fake 工作流自动建立首版时间线并调用既有 MP4 导出。
